// ─── Database Models ──────────────────────────────────────────────────────────

export interface User {
  id: string; // Google sub ID
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface EmailAttachment {
  filename: string;
  mimetype: string;
  size: number;
  dataUrl: string;
}

export interface EmailCampaign {
  id: string;
  user_id: string;
  sender_email: string;
  sender_name: string | null;
  subject: string;
  body: string;
  scheduled_at: Date;
  delay_between_emails_ms: number;
  hourly_limit: number;
  total_recipients: number;
  status: 'active' | 'completed' | 'cancelled' | 'paused';
  attachments?: EmailAttachment[];
  created_at: Date;
  updated_at: Date;
}

export type EmailJobStatus = 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface EmailJob {
  id: string;
  campaign_id: string;
  user_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  sender_email: string;
  sender_name: string | null;
  bull_job_id: string | null;
  status: EmailJobStatus;
  scheduled_at: Date;
  sent_at: Date | null;
  error_message: string | null;
  attempt_count: number;
  preview_url: string | null;
  attachments?: EmailAttachment[];
  created_at: Date;
  updated_at: Date;
}

// ─── BullMQ Job Data ──────────────────────────────────────────────────────────

export interface EmailJobData {
  emailJobId: string;
  campaignId: string;
  userId: string;
  recipientEmail: string;
  senderEmail: string;
  senderName: string | null;
  subject: string;
  body: string;
  scheduledAt: string; // ISO string
  attachments?: EmailAttachment[];
}

// ─── API Request/Response Types ───────────────────────────────────────────────

export interface ScheduleEmailRequest {
  sender_email: string;
  sender_name?: string;
  subject: string;
  body: string;
  recipients: string[];
  scheduled_at: string; // ISO 8601
  delay_between_emails_ms?: number;
  hourly_limit?: number;
  attachments?: EmailAttachment[];
}

export interface ScheduleEmailResponse {
  campaign_id: string;
  total_jobs: number;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

// ─── Auth Types ───────────────────────────────────────────────────────────────

export interface JwtPayload {
  userId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  iat?: number;
  exp?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
