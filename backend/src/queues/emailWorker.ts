import { Worker, Job, UnrecoverableError } from 'bullmq';
import { createRedisConnection, getRedisClient } from '../config/redis';
import { getPool } from '../config/database';
import { sendEmail, sleep } from '../services/emailSender';
import { checkAndIncrementRateLimit, getNextHourWindowMs } from '../services/rateLimiter';
import { scheduleEmailJob, EMAIL_QUEUE_NAME } from './emailQueue';
import { config } from '../config';
import { EmailJobData } from '../types';

const IDEMPOTENCY_KEY_PREFIX = 'processed';
const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 48; // 48 hours

/**
 * Check if this email job has already been processed (idempotency guard).
 * Uses Redis SET NX (set-if-not-exists) — safe across multiple workers.
 */
async function markAsProcessed(emailJobId: string): Promise<boolean> {
  const redis = getRedisClient();
  const key = `${IDEMPOTENCY_KEY_PREFIX}:${emailJobId}`;
  // SET key "1" NX EX ttl — returns "OK" if set, null if already existed
  const result = await redis.set(key, '1', 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
  return result === 'OK'; // true = we own this job, false = duplicate
}

/**
 * Update email job status in PostgreSQL.
 */
async function updateJobStatus(
  emailJobId: string,
  status: 'processing' | 'sent' | 'failed',
  extra: {
    sentAt?: Date;
    errorMessage?: string;
    previewUrl?: string;
    attemptCount?: number;
  } = {}
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE email_jobs
       SET status = $1,
           sent_at = $2,
           error_message = $3,
           preview_url = $4,
           attempt_count = COALESCE($5, attempt_count + 1),
           updated_at = NOW()
       WHERE id = $6`,
      [
        status,
        extra.sentAt ?? null,
        extra.errorMessage ?? null,
        extra.previewUrl ?? null,
        extra.attemptCount ?? null,
        emailJobId,
      ]
    );
  } finally {
    client.release();
  }
}

/**
 * The BullMQ email worker processor.
 *
 * Flow for each job:
 * 1. Idempotency check (Redis SET NX) — skip if already processed
 * 2. Rate limit check (Redis INCR atomic) — reschedule to next hour if exceeded
 * 3. Mark job as 'processing' in DB
 * 4. Send email via Ethereal SMTP
 * 5. Mark job as 'sent' in DB + save preview URL
 * 6. Enforce minimum delay between sends
 */
async function processEmailJob(job: Job<EmailJobData>): Promise<void> {
  const { emailJobId, senderEmail } = job.data;

  console.log(`⚡ Processing job ${job.id} [emailJobId: ${emailJobId}]`);

  // Step 1: Idempotency check
  const acquired = await markAsProcessed(emailJobId);
  if (!acquired) {
    console.warn(`⚠️  Job ${emailJobId} already processed — skipping (idempotency guard)`);
    return; // Silently skip duplicate
  }

  // Step 2: Rate limit check
  const rateLimitResult = await checkAndIncrementRateLimit(senderEmail, config.MAX_EMAILS_PER_HOUR_PER_SENDER);
  if (!rateLimitResult.allowed) {
    const nextWindowMs = rateLimitResult.nextWindowMs!;
    const delayUntilNextWindow = Math.max(0, nextWindowMs - Date.now()) + 1000; // +1s buffer

    console.warn(
      `🚦 Rate limit reached for ${senderEmail}. ` +
        `Rescheduling to next hour window in ${Math.round(delayUntilNextWindow / 1000)}s`
    );

    // Re-enqueue the job into the next hour window (not dropped, not failed)
    // We release the idempotency lock so the rescheduled job can claim it
    const redis = getRedisClient();
    await redis.del(`${IDEMPOTENCY_KEY_PREFIX}:${emailJobId}`);

    const rescheduleAt = new Date(nextWindowMs);
    const newBullJobId = `${emailJobId}_retry_${Date.now()}`;

    await scheduleEmailJob(job.data, rescheduleAt, newBullJobId);

    // Update DB scheduled_at to reflect the new time
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE email_jobs
         SET scheduled_at = $1, bull_job_id = $2, updated_at = NOW()
         WHERE id = $3`,
        [rescheduleAt.toISOString(), newBullJobId, emailJobId]
      );
    } finally {
      client.release();
    }

    // Throw an UnrecoverableError to stop BullMQ from retrying this specific job instance
    throw new UnrecoverableError(
      `Rate limit reached. Rescheduled to ${rescheduleAt.toISOString()}`
    );
  }

  // Step 3: Mark as processing in DB
  await updateJobStatus(emailJobId, 'processing');

  // Step 4: Send the email
  const result = await sendEmail(job.data);

  // Step 5: Minimum delay between sends (throttling simulation)
  await sleep(config.MIN_DELAY_BETWEEN_SENDS_MS);

  // Step 6: Mark as sent in DB
  await updateJobStatus(emailJobId, 'sent', {
    sentAt: new Date(),
    previewUrl: result.previewUrl ?? undefined,
    attemptCount: job.attemptsMade + 1,
  });

  // Update campaign status if all jobs are done
  await updateCampaignStatusIfComplete(job.data.campaignId);

  console.log(`✅ Email sent successfully [${emailJobId}] → ${job.data.recipientEmail}`);
}

/**
 * Check if all jobs in a campaign are complete (sent/failed/cancelled)
 * and update campaign status accordingly.
 */
async function updateCampaignStatusIfComplete(campaignId: string): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('scheduled', 'processing')) as pending,
         COUNT(*) as total
       FROM email_jobs WHERE campaign_id = $1`,
      [campaignId]
    );

    const pending = parseInt(rows[0].pending, 10);
    if (pending === 0) {
      await client.query(
        `UPDATE email_campaigns SET status = 'completed', updated_at = NOW() WHERE id = $1`,
        [campaignId]
      );
    }
  } finally {
    client.release();
  }
}

let worker: Worker<EmailJobData> | null = null;

/**
 * Start the BullMQ worker.
 * Concurrency is configurable via WORKER_CONCURRENCY env var.
 */
export function startEmailWorker(): Worker<EmailJobData> {
  if (worker) return worker;

  worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    processEmailJob,
    {
      connection: createRedisConnection(),
      concurrency: config.WORKER_CONCURRENCY,
      // BullMQ limiter ensures max throughput across all jobs
      limiter: {
        max: config.WORKER_CONCURRENCY,
        duration: config.MIN_DELAY_BETWEEN_SENDS_MS,
      },
    }
  );

  worker.on('completed', (job: Job<EmailJobData>) => {
    console.log(`✅ BullMQ job ${job.id} completed`);
  });

  worker.on('failed', (job: Job<EmailJobData> | undefined, err: Error) => {
    console.error(`❌ BullMQ job ${job?.id} failed:`, err.message);
    if (job) {
      updateJobStatus(job.data.emailJobId, 'failed', {
        errorMessage: err.message,
        attemptCount: job.attemptsMade,
      }).catch(console.error);
    }
  });

  worker.on('error', (err: Error) => {
    console.error('❌ Worker error:', err.message);
  });

  worker.on('stalled', (jobId: string) => {
    console.warn(`⚠️  Job ${jobId} stalled — will be retried`);
  });

  console.log(
    `🚀 BullMQ email worker started (concurrency: ${config.WORKER_CONCURRENCY}, ` +
      `min delay: ${config.MIN_DELAY_BETWEEN_SENDS_MS}ms, ` +
      `max/hour/sender: ${config.MAX_EMAILS_PER_HOUR_PER_SENDER})`
  );

  return worker;
}

export async function stopEmailWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    console.log('🛑 BullMQ email worker stopped');
  }
}
