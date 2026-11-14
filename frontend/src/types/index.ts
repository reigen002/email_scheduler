export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export type EmailJobStatus = 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface EmailAttachment {
  filename: string;
  mimetype: string;
  size: number;
  dataUrl: string;
}

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
  scheduled_at: string;
  sent_at: string | null;
  error_message: string | null;
  attempt_count: number;
  preview_url: string | null;
  attachments?: EmailAttachment[];
  created_at: string;
  updated_at: string;
}

export interface EmailCampaign {
  id: string;
  user_id: string;
  sender_email: string;
  sender_name: string | null;
  subject: string;
  body: string;
  scheduled_at: string;
  delay_between_emails_ms: number;
  hourly_limit: number;
  total_recipients: number;
  status: 'active' | 'completed' | 'cancelled' | 'paused';
  sent_count?: number;
  failed_count?: number;
  scheduled_count?: number;
  attachments?: EmailAttachment[];
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export interface ScheduleEmailPayload {
  sender_email: string;
  sender_name?: string;
  subject: string;
  body: string;
  recipients?: string[];
  scheduled_at: string;
  delay_between_emails_ms?: number;
  hourly_limit?: number;
  attachments?: EmailAttachment[];
}

export interface ScheduleEmailResponse {
  campaign_id: string;
  total_jobs: number;
  message: string;
}

export interface ParseCsvResponse {
  emails: string[];
  count: number;
}

export interface RateLimitStatus {
  currentCount: number;
  maxPerHour: number;
  remaining: number;
  resetsAt: string;
}

export interface ApiErrorResponse {
  error: string;
  details?: Record<string, string[]>;
}

export interface AuthResponse {
  token: string;
  user: User;
}
