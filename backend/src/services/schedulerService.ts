import { v4 as uuidv4 } from 'uuid';
import { getPool, withTransaction } from '../config/database';
import { scheduleEmailJob } from '../queues/emailQueue';
import type { PoolClient } from 'pg';
import type {
  EmailCampaign,
  EmailJob,
  ScheduleEmailRequest,
  ScheduleEmailResponse,
} from '../types';

/**
 * Schedule a full email campaign:
 * 1. Insert campaign into PostgreSQL
 * 2. Insert one email_job row per recipient
 * 3. Enqueue each job in BullMQ with the correct delay
 *
 * BullMQ persists delayed jobs in Redis — they survive server restarts.
 * Using emailJobId as BullMQ jobId ensures idempotency (BullMQ rejects duplicates).
 */
export async function scheduleEmailCampaign(
  userId: string,
  request: ScheduleEmailRequest
): Promise<ScheduleEmailResponse> {
  const campaignId = uuidv4();
  const scheduledAt = new Date(request.scheduled_at);
  const delayMs = request.delay_between_emails_ms ?? 2000;
  const hourlyLimit = request.hourly_limit ?? 200;
  const recipients = [...new Set(request.recipients)]; // Deduplicate

  const attachmentsJson = JSON.stringify(request.attachments ?? []);

  await withTransaction(async (client: PoolClient) => {
    // 1. Insert campaign
    await client.query(
      `INSERT INTO email_campaigns
        (id, user_id, sender_email, sender_name, subject, body,
         scheduled_at, delay_between_emails_ms, hourly_limit, total_recipients, attachments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        campaignId,
        userId,
        request.sender_email,
        request.sender_name ?? null,
        request.subject,
        request.body,
        scheduledAt.toISOString(),
        delayMs,
        hourlyLimit,
        recipients.length,
        attachmentsJson,
      ]
    );

    // 2. Insert every pending row; queue publication follows the commit.
    for (let i = 0; i < recipients.length; i++) {
      const emailJobId = uuidv4();
      const recipient = recipients[i];

      // Stagger jobs: each subsequent email is delayed by delayMs more
      const jobScheduledAt = new Date(scheduledAt.getTime() + i * delayMs);

      // Insert job record into DB
      await client.query(
        `INSERT INTO email_jobs
          (id, campaign_id, user_id, recipient_email, subject, body,
           sender_email, sender_name, bull_job_id, status, scheduled_at, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10, $11)`,
        [
          emailJobId,
          campaignId,
          userId,
          recipient,
          request.subject,
          request.body,
          request.sender_email,
          request.sender_name ?? null,
          emailJobId, // Use same ID for BullMQ job ID
          jobScheduledAt.toISOString(),
          attachmentsJson,
        ]
      );

    }
  });

  // Commit before publishing work. PostgreSQL is the durable outbox;
  // a Redis outage is repaired without losing an accepted request.
  await recoverPendingEmails(campaignId).catch(error => {
    console.error('Campaign saved; queue recovery will retry publishing:', error.message);
  });

  return {
    campaign_id: campaignId,
    total_jobs: recipients.length,
    message: `Scheduled ${recipients.length} email(s) for campaign ${campaignId}`,
  };
}

export async function recoverPendingEmails(campaignId?: string): Promise<void> {
  const { rows } = await getPool().query<EmailJob>(
    `SELECT * FROM email_jobs WHERE status IN ('scheduled', 'processing')
     ${campaignId ? 'AND campaign_id = $1' : ''} ORDER BY scheduled_at`,
    campaignId ? [campaignId] : []
  );
  for (const row of rows) {
    await scheduleEmailJob({
      emailJobId: row.id, campaignId: row.campaign_id, userId: row.user_id,
      recipientEmail: row.recipient_email, senderEmail: row.sender_email,
      senderName: row.sender_name, subject: row.subject, body: row.body,
      scheduledAt: row.scheduled_at.toISOString(), attachments: row.attachments,
    }, row.scheduled_at, row.bull_job_id ?? row.id);
  }
}

/**
 * Get scheduled email jobs for a user (status = 'scheduled' | 'processing').
 */
export async function getScheduledEmails(
  client: { query: PoolClient['query'] },
  userId: string,
  page: number = 1,
  limit: number = 50
): Promise<{ jobs: EmailJob[]; total: number }> {
  const offset = (page - 1) * limit;

  const [jobsResult, countResult] = await Promise.all([
    client.query(
      `SELECT * FROM email_jobs
       WHERE user_id = $1 AND status IN ('scheduled', 'processing')
       ORDER BY scheduled_at ASC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    client.query(
      `SELECT COUNT(*) FROM email_jobs WHERE user_id = $1 AND status IN ('scheduled', 'processing')`,
      [userId]
    ),
  ]);

  return {
    jobs: jobsResult.rows as EmailJob[],
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * Get sent/failed email jobs for a user.
 */
export async function getSentEmails(
  client: { query: PoolClient['query'] },
  userId: string,
  page: number = 1,
  limit: number = 50
): Promise<{ jobs: EmailJob[]; total: number }> {
  const offset = (page - 1) * limit;

  const [jobsResult, countResult] = await Promise.all([
    client.query(
      `SELECT * FROM email_jobs
       WHERE user_id = $1 AND status IN ('sent', 'failed', 'cancelled')
       ORDER BY COALESCE(sent_at, updated_at) DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    client.query(
      `SELECT COUNT(*) FROM email_jobs WHERE user_id = $1 AND status IN ('sent', 'failed', 'cancelled')`,
      [userId]
    ),
  ]);

  return {
    jobs: jobsResult.rows as EmailJob[],
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * Get campaigns for a user.
 */
export async function getCampaigns(
  client: { query: PoolClient['query'] },
  userId: string,
  page: number = 1,
  limit: number = 20
): Promise<{ campaigns: EmailCampaign[]; total: number }> {
  const offset = (page - 1) * limit;

  const [campaignsResult, countResult] = await Promise.all([
    client.query(
      `SELECT c.*,
         COUNT(j.id) FILTER (WHERE j.status = 'sent') as sent_count,
         COUNT(j.id) FILTER (WHERE j.status = 'failed') as failed_count,
         COUNT(j.id) FILTER (WHERE j.status = 'scheduled') as scheduled_count
       FROM email_campaigns c
       LEFT JOIN email_jobs j ON j.campaign_id = c.id
       WHERE c.user_id = $1
       GROUP BY c.id
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    client.query(
      `SELECT COUNT(*) FROM email_campaigns WHERE user_id = $1`,
      [userId]
    ),
  ]);

  return {
    campaigns: campaignsResult.rows as EmailCampaign[],
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * Cancel a scheduled email job (both in DB and BullMQ).
 */
export async function cancelEmailJob(
  client: { query: PoolClient['query'] },
  emailJobId: string,
  userId: string
): Promise<boolean> {
  const { cancelEmailJob: cancelBullJob } = await import('../queues/emailQueue');

  const result = await client.query(
    `UPDATE email_jobs
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'scheduled'
     RETURNING bull_job_id`,
    [emailJobId, userId]
  );

  if (result.rows.length === 0) return false;

  const bullJobId = result.rows[0].bull_job_id;
  if (bullJobId) {
    await cancelBullJob(bullJobId);
  }

  return true;
}

/**
 * Delete an email job (scheduled, sent, failed, or cancelled) for a user.
 */
export async function deleteEmailJob(
  client: { query: PoolClient['query'] },
  emailJobId: string,
  userId: string
): Promise<boolean> {
  const { cancelEmailJob: cancelBullJob } = await import('../queues/emailQueue');

  const result = await client.query(
    `DELETE FROM email_jobs
     WHERE id = $1 AND user_id = $2
     RETURNING bull_job_id, status`,
    [emailJobId, userId]
  );

  if (result.rows.length === 0) return false;

  const { bull_job_id, status } = result.rows[0];
  if (status === 'scheduled' && bull_job_id) {
    await cancelBullJob(bull_job_id);
  }

  return true;
}
