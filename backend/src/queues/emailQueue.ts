import { Queue } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { EmailJobData } from '../types';

let emailQueue: Queue<EmailJobData> | null = null;

export const EMAIL_QUEUE_NAME = 'email-delivery';

export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5s, 10s, 20s
        },
        removeOnComplete: {
          count: 500, // keep last 500 completed jobs in Redis for inspection
          age: 60 * 60 * 24 * 7, // 7 days
        },
        removeOnFail: {
          count: 500,
          age: 60 * 60 * 24 * 14, // 14 days
        },
      },
    });

    emailQueue.on('error', (err: Error) => {
      console.error('❌ Email queue error:', err.message);
    });
  }

  return emailQueue;
}

/**
 * Schedule an email job to be sent at a specific time.
 * Uses BullMQ delayed jobs — no cron required.
 * Jobs are persisted in Redis and survive server restarts.
 */
export async function scheduleEmailJob(
  jobData: EmailJobData,
  scheduledAt: Date,
  jobId: string
): Promise<string> {
  const queue = getEmailQueue();
  const now = Date.now();
  const delay = Math.max(0, scheduledAt.getTime() - now);

  const job = await queue.add(
    `email:${jobData.recipientEmail}`,
    jobData,
    {
      jobId, // Use emailJobId as BullMQ job ID for idempotency
      delay,
    }
  );

  return job.id!;
}

export async function cancelEmailJob(bullJobId: string): Promise<boolean> {
  const queue = getEmailQueue();
  const job = await queue.getJob(bullJobId);
  if (!job) return false;

  await job.remove();
  return true;
}

export async function closeEmailQueue(): Promise<void> {
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
}
