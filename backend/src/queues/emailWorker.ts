import { Worker, Job, DelayedError } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { getPool } from '../config/database';
import { sendEmail } from '../services/emailSender';
import { checkAndIncrementRateLimit, decrementRateLimit } from '../services/rateLimiter';
import { EMAIL_QUEUE_NAME } from './emailQueue';
import { config } from '../config';
import { EmailJobData } from '../types';

async function updateCampaignStatusIfComplete(campaignId: string): Promise<void> {
  await getPool().query(
    `UPDATE email_campaigns SET status = 'completed', updated_at = NOW()
     WHERE id = $1 AND NOT EXISTS (
       SELECT 1 FROM email_jobs WHERE campaign_id = $1 AND status IN ('scheduled', 'processing')
     )`,
    [campaignId]
  );
}

async function processEmailJob(job: Job<EmailJobData>, token?: string): Promise<void> {
  const { emailJobId, senderEmail, campaignId } = job.data;
  const pool = getPool();
  // BullMQ owns the active-job lock. Durable DB state records successful delivery;
  // claiming work must never be mistaken for having sent it.
  const { rows } = await pool.query(
    `SELECT j.status, c.hourly_limit FROM email_jobs j
     JOIN email_campaigns c ON c.id = j.campaign_id WHERE j.id = $1`,
    [emailJobId]
  );
  if (!rows.length || ['sent', 'cancelled', 'failed'].includes(rows[0].status)) return;

  const maxPerHour = Math.min(rows[0].hourly_limit, config.MAX_EMAILS_PER_HOUR_PER_SENDER);
  const quota = await checkAndIncrementRateLimit(senderEmail, maxPerHour);
  if (!quota.allowed) {
    const rescheduleAt = new Date(quota.nextWindowMs! + 1000);
    await pool.query(
      `UPDATE email_jobs SET status = 'scheduled', scheduled_at = $1, error_message = NULL, updated_at = NOW()
       WHERE id = $2`,
      [rescheduleAt, emailJobId]
    );
    // Moving the SAME job neither consumes an attempt nor fires 'failed'.
    await job.moveToDelayed(rescheduleAt.getTime(), token);
    throw new DelayedError();
  }

  let smtpAccepted = false;
  try {
    await pool.query(
      `UPDATE email_jobs SET status = 'processing', error_message = NULL,
       attempt_count = $1, updated_at = NOW() WHERE id = $2`,
      [job.attemptsMade + 1, emailJobId]
    );
    const result = await sendEmail(job.data);
    smtpAccepted = true;
    await pool.query(
      `UPDATE email_jobs SET status = 'sent', sent_at = NOW(), preview_url = $1,
       error_message = NULL, updated_at = NOW() WHERE id = $2`,
      [result.previewUrl, emailJobId]
    );
  } catch (error) {
    // SMTP acceptance followed by a DB outage remains an ambiguous delivery.
    if (!smtpAccepted) await decrementRateLimit(senderEmail);
    const status = job.attemptsMade + 1 >= (job.opts.attempts ?? 1) ? 'failed' : 'scheduled';
    await pool.query(
      `UPDATE email_jobs SET status = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
      [status, error instanceof Error ? error.message : String(error), emailJobId]
    );
    if (status === 'failed') await updateCampaignStatusIfComplete(campaignId);
    throw error;
  }
  await updateCampaignStatusIfComplete(campaignId);
  console.log(`Email sent [${emailJobId}] to ${job.data.recipientEmail}`);
}

let worker: Worker<EmailJobData> | null = null;
let workerConnection: ReturnType<typeof createRedisConnection> | null = null;

export function startEmailWorker(): Worker<EmailJobData> {
  if (worker) return worker;
  workerConnection = createRedisConnection();
  worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmailJob, {
    connection: workerConnection,
    concurrency: config.WORKER_CONCURRENCY,
    // Shared across worker instances: increasing concurrency cannot start a burst.
    ...(config.MIN_DELAY_BETWEEN_SENDS_MS > 0 ? {
      limiter: { max: 1, duration: config.MIN_DELAY_BETWEEN_SENDS_MS },
    } : {}),
  });
  worker.on('failed', (job, error) => console.error(`Email job ${job?.id} attempt failed: ${error.message}`));
  worker.on('error', error => console.error('Worker error:', error.message));
  worker.on('stalled', id => console.warn(`Stalled job ${id} will be retried`));
  console.log(`Email worker started (concurrency ${config.WORKER_CONCURRENCY})`);
  return worker;
}

export async function stopEmailWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (workerConnection) {
    await workerConnection.quit();
    workerConnection = null;
  }
}
