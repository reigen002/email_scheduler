import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticateJWT } from '../middleware/auth';
import { getPool } from '../config/database';
import {
  scheduleEmailCampaign,
  getScheduledEmails,
  getSentEmails,
  getCampaigns,
  cancelEmailJob,
  deleteEmailJob,
} from '../services/schedulerService';
import { getRateLimitStatus } from '../services/rateLimiter';

const router = Router();

// All email routes require authentication
router.use(authenticateJWT);

// Multer setup for CSV and attachment uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
});

/**
 * Parse email addresses from CSV/text content.
 * Supports: comma-separated, newline-separated, or one-per-line CSV with header.
 */
function parseEmailsFromCsv(content: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = content.match(emailRegex) ?? [];
  return [...new Set(matches)];
}

// ─── Request Schemas ──────────────────────────────────────────────────────────

const scheduleEmailSchema = z.object({
  sender_email: z.string().email(),
  sender_name: z.string().optional(),
  subject: z.string().min(1).max(998),
  body: z.string().min(1),
  recipients: z.array(z.string().email()).min(1).max(10000).optional(),
  scheduled_at: z.string().datetime({ offset: true }),
  delay_between_emails_ms: z.coerce.number().min(0).max(3600000).default(2000),
  hourly_limit: z.coerce.number().min(1).max(10000).default(200),
  attachments: z.array(z.object({
    filename: z.string(),
    mimetype: z.string(),
    size: z.number(),
    dataUrl: z.string(),
  })).optional(),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/emails/schedule
 * Schedule an email campaign. Accepts JSON or multipart/form-data.
 */
router.post(
  '/schedule',
  upload.fields([
    { name: 'recipients_file', maxCount: 1 },
    { name: 'attachments', maxCount: 10 },
  ]),
  async (req: Request, res: Response) => {
    try {
      let recipients: string[] = [];
      let attachments: any[] = [];

      const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

      // Parse recipients from uploaded CSV file if present
      if (filesObj?.recipients_file?.[0]) {
        const csvContent = filesObj.recipients_file[0].buffer.toString('utf-8');
        recipients = parseEmailsFromCsv(csvContent);
        if (recipients.length === 0) {
          return res.status(400).json({ error: 'No valid email addresses found in the file' });
        }
      }

      // Parse recipients from JSON body
      const bodyRecipients = req.body.recipients;
      if (bodyRecipients) {
        const parsed =
          typeof bodyRecipients === 'string'
            ? JSON.parse(bodyRecipients)
            : bodyRecipients;
        recipients = [...new Set([...recipients, ...parsed])];
      }

      if (recipients.length === 0) {
        return res.status(400).json({
          error: 'At least one recipient is required (via "recipients" field or uploaded CSV file)',
        });
      }

      // Parse attachments from JSON body
      if (req.body.attachments) {
        try {
          attachments = typeof req.body.attachments === 'string'
            ? JSON.parse(req.body.attachments)
            : req.body.attachments;
        } catch {}
      }

      // Parse attachments from multipart files
      if (filesObj?.attachments) {
        for (const file of filesObj.attachments) {
          const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
          attachments.push({
            filename: file.originalname,
            mimetype: file.mimetype,
            size: file.size,
            dataUrl,
          });
        }
      }

      const parsed = scheduleEmailSchema.safeParse({
        ...req.body,
        recipients,
        attachments,
      });

      if (!parsed.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      // Reject scheduled times more than 60s in the past
      const scheduledAt = new Date(parsed.data.scheduled_at);
      const sixtySecondsAgo = new Date(Date.now() - 60_000);
      if (scheduledAt < sixtySecondsAgo) {
        return res.status(400).json({
          error: `Scheduled time is in the past. Please choose a future time (got: ${scheduledAt.toISOString()})`,
        });
      }

      const result = await scheduleEmailCampaign(req.user!.id, {
        ...parsed.data,
        recipients,
        attachments: parsed.data.attachments,
      });
      return res.status(201).json(result);

    } catch (err) {
      console.error('Schedule email error:', err);
      return res.status(500).json({ error: 'Failed to schedule email campaign' });
    }
  }
);

/**
 * POST /api/emails/parse-csv
 * Parse a CSV file and return the list of email addresses (preview before scheduling).
 */
router.post(
  '/parse-csv',
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    try {
      const content = req.file.buffer.toString('utf-8');
      const emails = parseEmailsFromCsv(content);
      return res.json({ emails, count: emails.length });
    } catch (err) {
      return res.status(400).json({ error: 'Failed to parse CSV file' });
    }
  }
);

/**
 * GET /api/emails/scheduled
 * Get scheduled (pending) emails for the authenticated user.
 */
router.get('/scheduled', async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10);
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
    const pool = getPool();
    const client = await pool.connect();
    try {
      const { jobs, total } = await getScheduledEmails(client, req.user!.id, page, limit);
      return res.json({
        data: jobs,
        total,
        page,
        limit,
        has_more: page * limit < total,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Get scheduled emails error:', err);
    return res.status(500).json({ error: 'Failed to fetch scheduled emails' });
  }
});

/**
 * GET /api/emails/sent
 * Get sent/failed emails for the authenticated user.
 */
router.get('/sent', async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10);
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 100);
    const pool = getPool();
    const client = await pool.connect();
    try {
      const { jobs, total } = await getSentEmails(client, req.user!.id, page, limit);
      return res.json({
        data: jobs,
        total,
        page,
        limit,
        has_more: page * limit < total,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Get sent emails error:', err);
    return res.status(500).json({ error: 'Failed to fetch sent emails' });
  }
});

/**
 * GET /api/emails/campaigns
 * Get all campaigns with aggregate stats.
 */
router.get('/campaigns', async (req: Request, res: Response) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10);
    const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 50);
    const pool = getPool();
    const client = await pool.connect();
    try {
      const { campaigns, total } = await getCampaigns(client, req.user!.id, page, limit);
      return res.json({
        data: campaigns,
        total,
        page,
        limit,
        has_more: page * limit < total,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Get campaigns error:', err);
    return res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

/**
 * DELETE /api/emails/:id/cancel
 * Cancel a scheduled email job.
 */
router.delete('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      const cancelled = await cancelEmailJob(client, req.params.id, req.user!.id);
      if (!cancelled) {
        return res.status(404).json({
          error: 'Email job not found or cannot be cancelled (already sent/failed)',
        });
      }
      return res.json({ message: 'Email job cancelled successfully' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Cancel email error:', err);
    return res.status(500).json({ error: 'Failed to cancel email job' });
  }
});

/**
 * DELETE /api/emails/:id
 * Delete an email job completely (scheduled, sent, or failed).
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const client = await pool.connect();
    try {
      const deleted = await deleteEmailJob(client, req.params.id, req.user!.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Email job not found' });
      }
      return res.json({ message: 'Email job deleted successfully' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Delete email error:', err);
    return res.status(500).json({ error: 'Failed to delete email job' });
  }
});

/**
 * GET /api/emails/rate-limit/:senderEmail
 * Get rate limit status for a sender.
 */
router.get('/rate-limit/:senderEmail', async (req: Request, res: Response) => {
  try {
    const status = await getRateLimitStatus(req.params.senderEmail);
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch rate limit status' });
  }
});

export default router;
