'use client';

import React from 'react';
import { Mail, InboxIcon, Send } from 'lucide-react';

interface EmptyStateProps {
  type: 'scheduled' | 'sent' | 'campaigns';
  onCompose?: () => void;
}

const CONFIGS = {
  scheduled: {
    icon: InboxIcon,
    title: 'No scheduled emails',
    description: 'You have no emails waiting to be sent. Schedule your first email campaign to get started.',
    actionLabel: 'Schedule Email',
    iconColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
  },
  sent: {
    icon: Send,
    title: 'No sent emails yet',
    description: 'Emails you send will appear here once they\'ve been delivered.',
    actionLabel: 'Schedule Email',
    iconColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
  },
  campaigns: {
    icon: Mail,
    title: 'No campaigns yet',
    description: 'Create your first email campaign to start sending emails at scale.',
    actionLabel: 'Create Campaign',
    iconColor: 'text-violet-400',
    bgColor: 'bg-violet-500/10',
  },
};

export function EmptyState({ type, onCompose }: EmptyStateProps) {
  const config = CONFIGS[type];
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className={`w-20 h-20 rounded-2xl ${config.bgColor} flex items-center justify-center mb-6`}>
        <Icon className={`w-10 h-10 ${config.iconColor}`} strokeWidth={1.5} />
      </div>
      <h3 className="text-xl font-semibold text-white mb-2">{config.title}</h3>
      <p className="text-slate-400 text-sm text-center max-w-sm mb-8">{config.description}</p>
      {onCompose && (
        <button
          onClick={onCompose}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/20 active:scale-95"
        >
          <Mail className="w-4 h-4" />
          {config.actionLabel}
        </button>
      )}
    </div>
  );
}
