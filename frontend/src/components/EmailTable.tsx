'use client';

import React from 'react';
import { EmailJob } from '@/types';
import { StatusBadge } from './StatusBadge';
import { format, formatDistanceToNow } from 'date-fns';
import { ExternalLink, X, Clock, User, Mail } from 'lucide-react';

interface EmailTableProps {
  emails: EmailJob[];
  type: 'scheduled' | 'sent';
  isLoading: boolean;
  onCancel?: (id: string) => Promise<void>;
}

function SkeletonRow() {
  return (
    <tr className="border-b border-white/5">
      {[...Array(5)].map((_, i) => (
        <td key={i} className="px-4 py-4">
          <div className="h-4 bg-white/5 rounded animate-pulse" style={{ width: `${60 + i * 10}%` }} />
        </td>
      ))}
    </tr>
  );
}

export function EmailTable({ emails, type, isLoading, onCancel }: EmailTableProps) {
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);

  const handleCancel = async (id: string) => {
    if (!onCancel) return;
    setCancellingId(id);
    try {
      await onCancel(id);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-white/5">
            <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
              Recipient
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
              Subject
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
              {type === 'scheduled' ? 'Scheduled For' : 'Sent At'}
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
              Status
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
            : emails.map((email) => (
                <tr
                  key={email.id}
                  className="border-b border-white/5 hover:bg-white/2 transition-colors group"
                >
                  {/* Recipient */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500/20 to-violet-600/20 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
                        <User className="w-3.5 h-3.5 text-indigo-400" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium truncate max-w-[180px]">
                          {email.recipient_email}
                        </p>
                        <p className="text-slate-500 text-xs truncate max-w-[180px]">
                          From: {email.sender_email}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Subject */}
                  <td className="px-4 py-4">
                    <p className="text-slate-200 text-sm truncate max-w-[240px]">{email.subject}</p>
                  </td>

                  {/* Time */}
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-1.5 text-slate-400">
                      <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm text-slate-300">
                          {type === 'scheduled'
                            ? format(new Date(email.scheduled_at), 'MMM d, yyyy HH:mm')
                            : email.sent_at
                            ? format(new Date(email.sent_at), 'MMM d, yyyy HH:mm')
                            : '—'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {type === 'scheduled'
                            ? formatDistanceToNow(new Date(email.scheduled_at), { addSuffix: true })
                            : email.sent_at
                            ? formatDistanceToNow(new Date(email.sent_at), { addSuffix: true })
                            : ''}
                        </p>
                      </div>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-4">
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={email.status} />
                      {email.error_message && (
                        <p className="text-xs text-red-400 truncate max-w-[160px]" title={email.error_message}>
                          {email.error_message}
                        </p>
                      )}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Preview URL for sent emails */}
                      {email.preview_url && (
                        <a
                          href={email.preview_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 hover:border-indigo-400/50 rounded-lg transition-colors"
                          title="View email preview"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Preview
                        </a>
                      )}

                      {/* Cancel button for scheduled emails */}
                      {type === 'scheduled' && email.status === 'scheduled' && onCancel && (
                        <button
                          onClick={() => handleCancel(email.id)}
                          disabled={cancellingId === email.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Cancel this email"
                        >
                          {cancellingId === email.id ? (
                            <div className="w-3 h-3 border border-red-400/50 border-t-red-400 rounded-full animate-spin" />
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                          Cancel
                        </button>
                      )}

                      {/* Mail icon placeholder for sent without preview */}
                      {type === 'sent' && !email.preview_url && (
                        <span className="text-xs text-slate-600 italic">No preview</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
