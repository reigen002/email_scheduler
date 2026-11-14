'use client';

import { useState, useCallback } from 'react';
import { EmailJob, EmailCampaign, PaginatedResponse } from '@/types';
import { emailApi } from '@/lib/api';

export function useScheduledEmails() {
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScheduled = useCallback(async (p: number = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const res: PaginatedResponse<EmailJob> = await emailApi.getScheduled(p, 50);
      setEmails(res.data);
      setTotal(res.total);
      setPage(p);
    } catch (err: unknown) {
      setError('Failed to load scheduled emails');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const cancelEmail = useCallback(
    async (id: string) => {
      await emailApi.cancel(id);
      await fetchScheduled(page);
    },
    [fetchScheduled, page]
  );

  const deleteEmail = useCallback(
    async (id: string) => {
      await emailApi.delete(id);
      await fetchScheduled(page);
    },
    [fetchScheduled, page]
  );

  return { emails, total, page, isLoading, error, fetchScheduled, cancelEmail, deleteEmail };
}

export function useSentEmails() {
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSent = useCallback(async (p: number = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const res: PaginatedResponse<EmailJob> = await emailApi.getSent(p, 50);
      setEmails(res.data);
      setTotal(res.total);
      setPage(p);
    } catch (err: unknown) {
      setError('Failed to load sent emails');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteEmail = useCallback(
    async (id: string) => {
      await emailApi.delete(id);
      await fetchSent(page);
    },
    [fetchSent, page]
  );

  return { emails, total, page, isLoading, error, fetchSent, deleteEmail };
}

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async (p: number = 1) => {
    setIsLoading(true);
    setError(null);
    try {
      const res: PaginatedResponse<EmailCampaign> = await emailApi.getCampaigns(p, 20);
      setCampaigns(res.data);
      setTotal(res.total);
    } catch (err: unknown) {
      setError('Failed to load campaigns');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { campaigns, total, isLoading, error, fetchCampaigns };
}
