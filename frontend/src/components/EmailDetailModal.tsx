'use client';

import React, { useState } from 'react';
import { EmailJob, User as UserType } from '@/types';
import { ArrowLeft, Star, Trash2, ChevronDown, ExternalLink, Paperclip, Download } from 'lucide-react';
import { format } from 'date-fns';

interface EmailDetailModalProps {
  email: EmailJob | null;
  onClose: () => void;
  onDelete?: (id: string) => Promise<void>;
  currentUser?: UserType | null;
}

interface ParsedAttachment {
  name: string;
  url: string;
  size: string;
  type: 'image' | 'file';
}

function getInitials(name?: string | null, email?: string) {
  if (name && name.trim()) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  if (email && email.trim()) {
    return email[0].toUpperCase();
  }
  return 'A';
}

function formatDate(dateStr?: string | null) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return format(d, 'MMM d, h:mm a');
  } catch {
    return dateStr;
  }
}

function formatFileSize(bytes: number) {
  if (!bytes) return 'Unknown';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Extract attachments from email job data or inline images in body
 */
function getEmailAttachments(email: EmailJob): ParsedAttachment[] {
  const list: ParsedAttachment[] = [];

  // 1. Stored attachments from backend DB
  if (email.attachments && Array.isArray(email.attachments)) {
    for (const att of email.attachments) {
      const isImg = att.mimetype?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(att.filename);
      list.push({
        name: att.filename,
        url: att.dataUrl,
        size: formatFileSize(att.size),
        type: isImg ? 'image' : 'file',
      });
    }
  }

  // 2. Extract inline images from body HTML if any
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  let imgCount = 1;
  while ((match = imgRegex.exec(email.body)) !== null) {
    const src = match[1];
    const urlPath = src.split('?')[0];
    const rawName = urlPath.substring(urlPath.lastIndexOf('/') + 1) || `image_${imgCount}`;
    const name = decodeURIComponent(rawName);
    if (!list.some(a => a.url === src)) {
      list.push({
        name,
        url: src,
        size: '1.2 MB',
        type: 'image',
      });
    }
    imgCount++;
  }

  return list;
}

export function EmailDetailModal({ email, onClose, onDelete, currentUser }: EmailDetailModalProps) {
  const [isStarred, setIsStarred] = useState(false);
  const [showRecipientDetails, setShowRecipientDetails] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  if (!email) return null;

  const senderName = email.sender_name?.trim() || email.sender_email.split('@')[0];
  const formattedSenderName = senderName.charAt(0).toUpperCase() + senderName.slice(1);
  const dateToDisplay = email.sent_at ?? email.scheduled_at;
  const attachments = getEmailAttachments(email);

  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete(email.id);
      onClose();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete email. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownloadAttachment = (attachment: ParsedAttachment) => {
    // Triggers direct download/open of the file itself
    const link = document.createElement('a');
    link.href = attachment.url;
    link.download = attachment.name;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>

        {/* ── Top Header ───────────────────────────────────── */}
        <header style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <button
              type="button"
              onClick={onClose}
              style={styles.iconBtn}
              title="Back"
            >
              <ArrowLeft size={18} color="#333" />
            </button>
            <h1 style={styles.subjectTitle} title={email.subject}>
              {email.subject}
            </h1>
          </div>

          {/* Action Icons (Star + Delete + User Avatar) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Star Icon */}
            <button
              type="button"
              onClick={() => setIsStarred(s => !s)}
              style={styles.actionBtn}
              title={isStarred ? 'Unstar' : 'Star'}
            >
              <Star
                size={18}
                color={isStarred ? '#faad14' : '#666'}
                fill={isStarred ? '#faad14' : 'none'}
              />
            </button>

            {/* Trash / Delete Icon */}
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              style={{ ...styles.actionBtn, opacity: isDeleting ? 0.5 : 1, cursor: 'pointer' }}
              title="Delete email"
            >
              <Trash2 size={18} color="#666" />
            </button>

            {/* Divider */}
            <div style={{ width: 1, height: 20, background: '#e0e0e0', margin: '0 4px' }} />

            {/* Current User Avatar */}
            {currentUser?.avatarUrl ? (
              <img
                src={currentUser.avatarUrl}
                alt={currentUser.name ?? ''}
                style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div style={styles.userAvatar}>
                {getInitials(currentUser?.name, currentUser?.email)}
              </div>
            )}
          </div>
        </header>

        {/* ── Main Detail Content ─────────────────────────── */}
        <div style={styles.bodyWrap}>

          {/* Email Header Info */}
          <div style={styles.emailHeaderRow}>
            {/* Sender Avatar Circle */}
            <div style={styles.senderAvatar}>
              {getInitials(email.sender_name, email.sender_email)}
            </div>

            {/* Sender & Recipient Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
                  {formattedSenderName}
                </span>
                <span style={{ fontSize: 13, color: '#777' }}>
                  &lt;{email.sender_email}&gt;
                </span>
              </div>

              {/* To me dropdown toggle */}
              <div style={{ position: 'relative', marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => setShowRecipientDetails(s => !s)}
                  style={styles.toMeBtn}
                >
                  to me <ChevronDown size={12} color="#888" style={{ transform: showRecipientDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>

                {showRecipientDetails && (
                  <div style={styles.recipientPopover}>
                    <div><strong>From:</strong> {email.sender_email}</div>
                    <div><strong>To:</strong> {email.recipient_email}</div>
                    <div><strong>Status:</strong> {email.status}</div>
                    <div><strong>Date:</strong> {formatDate(dateToDisplay)}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Date & Time */}
            <div style={{ fontSize: 12, color: '#888', fontWeight: 500, flexShrink: 0 }}>
              {formatDate(dateToDisplay)}
            </div>
          </div>

          {/* Email Body Content */}
          <div style={styles.contentBody}>
            {email.body.includes('<') && email.body.includes('>') ? (
              <div
                dangerouslySetInnerHTML={{ __html: email.body }}
                style={{ lineHeight: 1.6, color: '#222' }}
              />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, color: '#222' }}>
                {email.body}
              </div>
            )}
          </div>

          {/* ── Attachments Section — only shown when actual attachments exist ── */}
          {attachments.length > 0 && (
            <div style={styles.attachmentsWrap}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#555', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Paperclip size={14} color="#4caf50" /> Attachments ({attachments.length})
              </h4>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {attachments.map((att, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleDownloadAttachment(att)}
                    style={styles.attachmentCard}
                    title={`Click to open/download ${att.name}`}
                  >
                    <div style={s.attachmentPreviewBox}>
                      {att.type === 'image' ? (
                        <img src={att.url} alt={att.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <Paperclip size={28} color="#4caf50" />
                      )}
                    </div>
                    <div style={{ padding: '8px 12px' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {att.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#888', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>{att.size}</span>
                        <Download size={12} color="#4caf50" style={{ marginLeft: 'auto' }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

const s = {
  attachmentPreviewBox: {
    height: 110,
    background: '#f8f9fa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottom: '1px solid #eaeaea',
    overflow: 'hidden',
  },
};

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 60,
    background: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 24px',
    borderBottom: '1px solid #f0f0f0',
    background: '#fff',
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 6,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  subjectTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#111',
    margin: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: '#4caf50',
    color: '#fff',
    fontSize: 12,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyWrap: {
    flex: 1,
    overflowY: 'auto',
    padding: '30px 48px',
    maxWidth: 900,
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  },
  emailHeaderRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 28,
  },
  senderAvatar: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    background: '#4caf50',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  toMeBtn: {
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: 12,
    color: '#777',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
  },
  recipientPopover: {
    position: 'absolute',
    top: 22,
    left: 0,
    zIndex: 20,
    background: '#ffffff',
    border: '1px solid #eaeaea',
    borderRadius: 8,
    padding: '10px 14px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
    fontSize: 12,
    color: '#444',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 220,
  },
  contentBody: {
    fontSize: 14,
    color: '#222222',
    lineHeight: 1.7,
    marginBottom: 40,
  },
  attachmentsWrap: {
    marginTop: 30,
    paddingTop: 20,
    borderTop: '1px solid #f0f0f0',
  },
  attachmentCard: {
    width: 180,
    borderRadius: 12,
    border: '1px solid #e0e0e0',
    overflow: 'hidden',
    background: '#ffffff',
    textDecoration: 'none',
    color: 'inherit',
    display: 'block',
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
    cursor: 'pointer',
    transition: 'transform 0.15s, box-shadow 0.15s',
  },
};
