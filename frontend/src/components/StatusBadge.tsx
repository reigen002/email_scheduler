'use client';

import React from 'react';
import { EmailJobStatus } from '@/types';

interface StatusBadgeProps {
  status: EmailJobStatus | 'active' | 'completed' | 'paused';
  size?: 'sm' | 'md';
}

const STATUS_CONFIG: Record<string, { label: string; className: string; dotColor: string }> = {
  scheduled: {
    label: 'Scheduled',
    className: 'bg-blue-500/15 text-blue-300 border border-blue-500/25',
    dotColor: 'bg-blue-400',
  },
  processing: {
    label: 'Processing',
    className: 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25',
    dotColor: 'bg-yellow-400 animate-pulse',
  },
  sent: {
    label: 'Sent',
    className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25',
    dotColor: 'bg-emerald-400',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/15 text-red-300 border border-red-500/25',
    dotColor: 'bg-red-400',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-slate-500/15 text-slate-400 border border-slate-500/25',
    dotColor: 'bg-slate-500',
  },
  active: {
    label: 'Active',
    className: 'bg-violet-500/15 text-violet-300 border border-violet-500/25',
    dotColor: 'bg-violet-400',
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25',
    dotColor: 'bg-emerald-400',
  },
  paused: {
    label: 'Paused',
    className: 'bg-orange-500/15 text-orange-300 border border-orange-500/25',
    dotColor: 'bg-orange-400',
  },
};

export function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.scheduled;
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${sizeClass} ${config.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dotColor}`} />
      {config.label}
    </span>
  );
}
