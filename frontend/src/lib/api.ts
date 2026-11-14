import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import {
  EmailJob,
  EmailCampaign,
  PaginatedResponse,
  ScheduleEmailPayload,
  ScheduleEmailResponse,
  ParseCsvResponse,
  RateLimitStatus,
  User,
  AuthResponse,
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ─── Axios Instance ───────────────────────────────────────────────────────────

const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Attach JWT token from localStorage to every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Handle 401 globally — clear token and redirect to login
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ─── Auth API ─────────────────────────────────────────────────────────────────

export const authApi = {
  /** Exchange Google ID token for our JWT */
  googleToken: async (idToken: string): Promise<AuthResponse> => {
    const { data } = await apiClient.post<AuthResponse>('/auth/google/token', {
      id_token: idToken,
    });
    return data;
  },

  /** Get Google OAuth redirect URL */
  getGoogleAuthUrl: (): string => `${API_URL}/api/auth/google`,

  /** Get current user */
  me: async (): Promise<User> => {
    const { data } = await apiClient.get<User>('/auth/me');
    return data;
  },

  /** Logout */
  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
  },
};

// ─── Email API ────────────────────────────────────────────────────────────────

export const emailApi = {
  /** Schedule a new email campaign */
  schedule: async (
    payload: ScheduleEmailPayload,
    file?: File
  ): Promise<ScheduleEmailResponse> => {
    if (file) {
      // Use multipart/form-data when a CSV file is included
      const formData = new FormData();
      formData.append('recipients_file', file);
      formData.append('sender_email', payload.sender_email);
      if (payload.sender_name) formData.append('sender_name', payload.sender_name);
      formData.append('subject', payload.subject);
      formData.append('body', payload.body);
      formData.append('scheduled_at', payload.scheduled_at);
      if (payload.delay_between_emails_ms !== undefined) {
        formData.append('delay_between_emails_ms', String(payload.delay_between_emails_ms));
      }
      if (payload.hourly_limit !== undefined) {
        formData.append('hourly_limit', String(payload.hourly_limit));
      }
      if (payload.recipients?.length) {
        formData.append('recipients', JSON.stringify(payload.recipients));
      }
      if (payload.attachments?.length) {
        formData.append('attachments', JSON.stringify(payload.attachments));
      }

      const { data } = await apiClient.post<ScheduleEmailResponse>('/emails/schedule', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    }

    const { data } = await apiClient.post<ScheduleEmailResponse>('/emails/schedule', payload);
    return data;
  },

  /** Parse a CSV file and return list of emails */
  parseCsv: async (file: File): Promise<ParseCsvResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await apiClient.post<ParseCsvResponse>('/emails/parse-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },

  /** Get scheduled/pending emails */
  getScheduled: async (
    page: number = 1,
    limit: number = 50
  ): Promise<PaginatedResponse<EmailJob>> => {
    const { data } = await apiClient.get<PaginatedResponse<EmailJob>>('/emails/scheduled', {
      params: { page, limit },
    });
    return data;
  },

  /** Get sent/failed emails */
  getSent: async (
    page: number = 1,
    limit: number = 50
  ): Promise<PaginatedResponse<EmailJob>> => {
    const { data } = await apiClient.get<PaginatedResponse<EmailJob>>('/emails/sent', {
      params: { page, limit },
    });
    return data;
  },

  /** Get campaigns with aggregate stats */
  getCampaigns: async (
    page: number = 1,
    limit: number = 20
  ): Promise<PaginatedResponse<EmailCampaign>> => {
    const { data } = await apiClient.get<PaginatedResponse<EmailCampaign>>('/emails/campaigns', {
      params: { page, limit },
    });
    return data;
  },

  /** Cancel a scheduled email */
  cancel: async (emailJobId: string): Promise<{ message: string }> => {
    const { data } = await apiClient.delete<{ message: string }>(
      `/emails/${emailJobId}/cancel`
    );
    return data;
  },

  /** Delete any email job (scheduled, sent, or failed) */
  delete: async (emailJobId: string): Promise<{ message: string }> => {
    const { data } = await apiClient.delete<{ message: string }>(
      `/emails/${emailJobId}`
    );
    return data;
  },

  /** Get rate limit status for a sender */
  getRateLimitStatus: async (senderEmail: string): Promise<RateLimitStatus> => {
    const { data } = await apiClient.get<RateLimitStatus>(
      `/emails/rate-limit/${encodeURIComponent(senderEmail)}`
    );
    return data;
  },
};

export default apiClient;
