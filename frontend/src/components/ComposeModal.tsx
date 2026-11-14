'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ArrowLeft, Paperclip, Clock, Upload, X, ChevronDown, Calendar,
  Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Strikethrough, Undo2, Redo2, Quote,
} from 'lucide-react';
import { emailApi } from '@/lib/api';
import { ScheduleEmailPayload, EmailAttachment } from '@/types';
import { format } from 'date-fns';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (scheduledAt: string) => void;
  userEmail?: string;
  userName?: string;
}

interface FormState {
  senderEmail: string;
  senderName: string;
  subject: string;
  scheduledAt: string;
  delayMs: number;
  hourlyLimit: number;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fileToDataUrl(file: File): Promise<EmailAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: reader.result as string,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ── Recipient Chip ─────────────────────────────────────────── */
function EmailChip({ email, onRemove }: { email: string; onRemove: () => void }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20,
      border: '1.5px solid #4caf50', color: '#2d7a2d',
      fontSize: 12, fontWeight: 500, background: '#f0faf0',
      flexShrink: 0,
    }}>
      {email}
      <button type="button" onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: '#4caf50' }}>
        <X size={10} />
      </button>
    </span>
  );
}

/* ── Toolbar Button ─────────────────────────────────────────── */
function ToolBtn({ onClick, title, children, active }: { onClick: () => void; title: string; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      style={{
        padding: '4px 6px', borderRadius: 4, border: 'none',
        background: active ? '#e8f5e9' : 'transparent',
        cursor: 'pointer', color: active ? '#4caf50' : '#555',
        display: 'flex', alignItems: 'center',
      }}
    >
      {children}
    </button>
  );
}

/* ── Main Component ─────────────────────────────────────────── */
export function ComposeModal({ isOpen, onClose, onSuccess, userEmail, userName }: ComposeModalProps) {
  const [form, setForm] = useState<FormState>(() => ({
    senderEmail: userEmail ?? '',
    senderName: userName ?? '',
    subject: '',
    scheduledAt: format(new Date(Date.now() + 5 * 60 * 1000), "yyyy-MM-dd'T'HH:mm"),
    delayMs: 2000,
    hourlyLimit: 200,
  }));

  const [chips, setChips] = useState<string[]>([]);
  const [chipInput, setChipInput] = useState('');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedEmails, setParsedEmails] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [showSendLaterPopover, setShowSendLaterPopover] = useState(false);
  const [bodyHtml, setBodyHtml] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const chipInputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowSendLaterPopover(false);
      }
    };
    if (showSendLaterPopover) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSendLaterPopover]);

  const resetForm = () => {
    setForm({
      senderEmail: userEmail ?? '',
      senderName: userName ?? '',
      subject: '',
      scheduledAt: format(new Date(Date.now() + 5 * 60 * 1000), "yyyy-MM-dd'T'HH:mm"),
      delayMs: 2000,
      hourlyLimit: 200,
    });
    setChips([]);
    setChipInput('');
    setCsvFile(null);
    setParsedEmails([]);
    setAttachments([]);
    setError(null);
    setShowScheduler(false);
    setShowSendLaterPopover(false);
    setSelectedPreset(null);
    setBodyHtml('');
    if (editorRef.current) editorRef.current.innerHTML = '';
  };

  const handleClose = () => { resetForm(); onClose(); };

  /* ── Recipients ─────────────────────────────────────────── */
  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const addChip = (val: string) => {
    const emails = val.split(/[\s,;]+/).map(e => e.trim()).filter(e => isValidEmail(e));
    if (emails.length) {
      setChips(prev => [...new Set([...prev, ...emails])]);
    }
    setChipInput('');
  };

  const handleChipKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ' ', 'Tab'].includes(e.key)) {
      e.preventDefault();
      if (chipInput.trim()) addChip(chipInput);
    } else if (e.key === 'Backspace' && !chipInput && chips.length) {
      setChips(prev => prev.slice(0, -1));
    }
  };

  const handleFileDrop = useCallback(async (file: File) => {
    setIsParsing(true);
    setError(null);
    try {
      const result = await emailApi.parseCsv(file);
      setCsvFile(file);
      setParsedEmails(result.emails);
      setChips(prev => [...new Set([...prev, ...result.emails])]);
    } catch {
      setError('Failed to parse CSV. Please check the format.');
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleAttachmentAdd = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    setAttachments(prev => [...prev, ...fileArray]);
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const getAllRecipients = (): string[] => [...new Set([...chips, ...parsedEmails])];

  /* ── Presets ────────────────────────────────────────────── */
  const getPresets = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const formatISO = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

    const tSame = new Date(tomorrow);
    const t10 = new Date(tomorrow); t10.setHours(10, 0, 0, 0);
    const t11 = new Date(tomorrow); t11.setHours(11, 0, 0, 0);
    const t15 = new Date(tomorrow); t15.setHours(15, 0, 0, 0);

    return [
      { label: 'Tomorrow', value: formatISO(tSame) },
      { label: 'Tomorrow, 10:00 AM', value: formatISO(t10) },
      { label: 'Tomorrow, 11:00 AM', value: formatISO(t11) },
      { label: 'Tomorrow, 3:00 PM', value: formatISO(t15) },
    ];
  };

  /* ── Rich Text Editor ──────────────────────────────────── */
  const exec = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    editorRef.current?.focus();
  };

  /* ── Submit ─────────────────────────────────────────────── */
  const handleSubmit = async () => {
    setError(null);
    if (!form.senderEmail.trim() || !isValidEmail(form.senderEmail)) {
      setError('Please provide a valid sender email.');
      return;
    }
    const recipients = getAllRecipients();
    if (!recipients.length) { setError('Add at least one recipient.'); return; }
    if (!form.subject.trim()) { setError('Subject is required.'); return; }
    const body = editorRef.current?.innerHTML ?? '';
    if (!body.trim() || body === '<br>') { setError('Email body is required.'); return; }

    const scheduledAt = new Date(form.scheduledAt);
    if (scheduledAt <= new Date()) { setError('Scheduled time must be in the future.'); return; }

    setIsSubmitting(true);
    try {
      const attachmentPayloads = await Promise.all(attachments.map(fileToDataUrl));

      const payload: ScheduleEmailPayload = {
        sender_email: form.senderEmail,
        sender_name: form.senderName || undefined,
        subject: form.subject,
        body,
        scheduled_at: scheduledAt.toISOString(),
        delay_between_emails_ms: form.delayMs,
        hourly_limit: form.hourlyLimit,
        recipients: csvFile ? undefined : recipients,
        attachments: attachmentPayloads.length > 0 ? attachmentPayloads : undefined,
      };
      await emailApi.schedule(payload, csvFile ?? undefined);
      const sat = form.scheduledAt;
      resetForm();
      onSuccess(new Date(sat).toISOString());
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to schedule. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalRecipients = getAllRecipients().length;
  const visibleChips = chips.slice(0, 3);
  const presets = getPresets();

  if (!isOpen) return null;

  const s = composeStyles;

  return (
    <div style={s.overlay}>
      <div style={s.page}>

        {/* ── Hidden File Inputs ───────────────────────────── */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt"
          style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileDrop(f); }}
        />
        <input
          ref={attachmentInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleAttachmentAdd(e.target.files)}
        />

        {/* ── Header ─────────────────────────────────────── */}
        <div style={s.header}>
          <button type="button" onClick={handleClose} style={s.backBtn}>
            <ArrowLeft size={18} />
            <span style={{ fontSize: 18, fontWeight: 600 }}>Compose New Email</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              style={{ ...s.iconBtn, position: 'relative' }}
              title="Attach files"
            >
              <Paperclip size={18} color="#4caf50" />
              {attachments.length > 0 && (
                <span style={{
                  position: 'absolute', top: -2, right: -2,
                  fontSize: 10, fontWeight: 700, color: '#4caf50',
                  lineHeight: 1,
                }}>
                  {attachments.length}
                </span>
              )}
            </button>

            {/* Clock Schedule Toggle */}
            <button
              type="button"
              onClick={() => setShowScheduler(s => !s)}
              style={{ ...s.iconBtn, background: showScheduler ? '#e8f5e9' : 'transparent' }}
              title="Schedule time"
            >
              <Clock size={18} color="#4caf50" />
            </button>

            {/* Send Later Button */}
            <button
              id="send-later-btn"
              type="button"
              onClick={() => setShowSendLaterPopover(s => !s)}
              disabled={isSubmitting}
              style={s.sendLaterBtn}
            >
              Send Later
            </button>

            {/* ── Send Later Popover Card ───────────────────── */}
            {showSendLaterPopover && (
              <div ref={popoverRef} style={s.popoverCard}>
                <h3 style={s.popoverTitle}>Send Later</h3>

                {/* Date Time Picker Input */}
                <div style={s.dateInputContainer}>
                  <input
                    type="datetime-local"
                    value={form.scheduledAt}
                    onChange={e => {
                      setForm(f => ({ ...f, scheduledAt: e.target.value }));
                      setSelectedPreset(null);
                    }}
                    style={s.dateTimeInput}
                  />
                  <Calendar size={16} color="#888" style={{ pointerEvents: 'none' }} />
                </div>

                {/* Preset List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
                  {presets.map(p => {
                    const isSelected = selectedPreset === p.label || form.scheduledAt === p.value;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setForm(f => ({ ...f, scheduledAt: p.value }));
                          setSelectedPreset(p.label);
                        }}
                        style={{
                          textAlign: 'left',
                          fontSize: 13,
                          color: isSelected ? '#4caf50' : '#555',
                          fontWeight: isSelected ? 600 : 400,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '2px 0',
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#4caf50')}
                        onMouseLeave={e => (e.currentTarget.style.color = isSelected ? '#4caf50' : '#555')}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>

                {/* Popover Footer Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => setShowSendLaterPopover(false)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, color: '#333',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSendLaterPopover(false);
                      handleSubmit();
                    }}
                    disabled={isSubmitting}
                    style={{
                      padding: '6px 20px', borderRadius: 20,
                      border: '1.5px solid #4caf50', background: 'transparent',
                      color: '#4caf50', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f0faf0')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {isSubmitting ? 'Sending…' : 'Done'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div style={{ margin: '8px 40px 0', padding: '8px 14px', background: '#fdecea', border: '1px solid #f5c6c6', borderRadius: 8, fontSize: 13, color: '#c62828' }}>
            {error}
          </div>
        )}

        {/* ── Form Wrap ───────────────────────────────────── */}
        <div style={s.formWrap}>

          {/* From */}
          <div style={s.row}>
            <span style={s.label}>From</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <div style={s.fromChipContainer}>
                <input
                  type="email"
                  value={form.senderEmail}
                  onChange={e => setForm(f => ({ ...f, senderEmail: e.target.value }))}
                  placeholder="sender@domain.com"
                  style={s.fromInput}
                />
              </div>
            </div>
          </div>
          <div style={s.divider} />

          {/* To */}
          <div style={s.row}>
            <span style={s.label}>To</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
              {visibleChips.map(email => (
                <EmailChip key={email} email={email} onRemove={() => setChips(c => c.filter(e => e !== email))} />
              ))}
              {(chips.length > 3 || (parsedEmails.length > 0)) && (
                <span style={{ fontSize: 12, color: '#4caf50', fontWeight: 600, border: '1.5px solid #4caf50', borderRadius: 20, padding: '3px 10px', background: '#f0faf0' }}>
                  +{chips.length - visibleChips.length + (parsedEmails.filter(e => !chips.includes(e)).length)}
                </span>
              )}
              <input
                ref={chipInputRef}
                type="text"
                value={chipInput}
                onChange={e => setChipInput(e.target.value)}
                onKeyDown={handleChipKeyDown}
                onBlur={() => { if (chipInput.trim()) addChip(chipInput); }}
                placeholder={chips.length === 0 ? 'Type email and press Enter…' : ''}
                style={{ border: 'none', outline: 'none', fontSize: 13, color: '#333', minWidth: 180, background: 'transparent', padding: '2px 0' }}
              />
            </div>

            {/* Upload List Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={s.uploadBtn}
            >
              {isParsing ? '…' : <><Upload size={13} /> Upload List</>}
            </button>
          </div>

          {/* CSV info banner */}
          {csvFile && (
            <div style={{ padding: '4px 40px 4px 140px', fontSize: 12, color: '#4caf50', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>✅ {csvFile.name} ({parsedEmails.length} recipients)</span>
              <button
                type="button"
                onClick={() => { setCsvFile(null); setParsedEmails([]); }}
                style={{ color: '#999', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}
              >
                remove
              </button>
            </div>
          )}

          {/* Attached files banner */}
          {attachments.length > 0 && (
            <div style={{ padding: '6px 40px 6px 140px', fontSize: 12, color: '#333', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {attachments.map((file, idx) => (
                <span key={idx} style={{
                  background: '#f5f5f5', border: '1px solid #e0e0e0',
                  padding: '3px 10px', borderRadius: 16,
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12, color: '#444',
                }}>
                  <Paperclip size={12} color="#4caf50" />
                  <strong style={{ fontWeight: 600 }}>{file.name}</strong>
                  <span style={{ color: '#888', fontSize: 11 }}>({formatFileSize(file.size)})</span>
                  <button type="button" onClick={() => removeAttachment(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#999', display: 'flex' }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div style={s.divider} />

          {/* Subject */}
          <div style={s.row}>
            <span style={s.label}>Subject</span>
            <input
              type="text"
              value={form.subject}
              onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
              placeholder="Subject"
              style={s.plainInput}
            />
          </div>
          <div style={s.divider} />

          {/* Delay + Hourly */}
          <div style={{ ...s.row, gap: 24 }}>
            <span style={s.label}>Delay between 2 emails</span>
            <input
              type="number" min={0} max={3600000}
              value={form.delayMs}
              onChange={e => setForm(f => ({ ...f, delayMs: parseInt(e.target.value) || 0 }))}
              style={s.smallInput}
            />
            <span style={{ fontSize: 13, color: '#999', marginLeft: -8 }}>ms</span>
            <span style={{ fontSize: 13, color: '#555', marginLeft: 12 }}>Hourly Limit</span>
            <input
              type="number" min={1} max={10000}
              value={form.hourlyLimit}
              onChange={e => setForm(f => ({ ...f, hourlyLimit: parseInt(e.target.value) || 1 }))}
              style={s.smallInput}
            />
          </div>
          <div style={s.divider} />

          {/* Schedule Time (toggled by clock icon) */}
          {showScheduler && (
            <>
              <div style={s.row}>
                <span style={s.label}>Schedule At</span>
                <input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={e => setForm(f => ({ ...f, scheduledAt: e.target.value }))}
                  style={{ ...s.plainInput, colorScheme: 'light' }}
                />
              </div>
              <div style={s.divider} />
            </>
          )}

          {/* ── Body ─────────────────────────────────────── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'relative', flex: 1, margin: '12px 20px 0' }}>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                onInput={() => setBodyHtml(editorRef.current?.innerHTML ?? '')}
                style={{
                  minHeight: 180, outline: 'none', fontSize: 14,
                  color: '#333', lineHeight: 1.6, padding: '12px 0',
                }}
              />
              {!bodyHtml && (
                <div style={{ position: 'absolute', top: 12, left: 0, color: '#bbb', fontSize: 14, pointerEvents: 'none' }}>
                  Type Your Reply...
                </div>
              )}
            </div>

            {/* Formatting Toolbar */}
            <div style={s.toolbar}>
              <ToolBtn onClick={() => exec('undo')} title="Undo"><Undo2 size={14} /></ToolBtn>
              <ToolBtn onClick={() => exec('redo')} title="Redo"><Redo2 size={14} /></ToolBtn>
              <div style={s.sep} />
              <ToolBtn onClick={() => exec('formatBlock', 'p')} title="Normal text">
                <span style={{ fontSize: 12, fontWeight: 600 }}>T</span>
                <ChevronDown size={10} />
              </ToolBtn>
              <div style={s.sep} />
              <ToolBtn onClick={() => exec('bold')} title="Bold"><Bold size={13} /></ToolBtn>
              <ToolBtn onClick={() => exec('italic')} title="Italic"><Italic size={13} /></ToolBtn>
              <ToolBtn onClick={() => exec('underline')} title="Underline"><Underline size={13} /></ToolBtn>
              <div style={s.sep} />
              <ToolBtn onClick={() => exec('justifyLeft')} title="Align left"><AlignLeft size={13} /></ToolBtn>
              <ToolBtn onClick={() => exec('justifyCenter')} title="Align center"><AlignCenter size={13} /></ToolBtn>
              <ToolBtn onClick={() => exec('justifyRight')} title="Align right"><AlignRight size={13} /></ToolBtn>
              <div style={s.sep} />
              <ToolBtn onClick={() => exec('insertOrderedList')} title="Numbered list"><ListOrdered size={13} /></ToolBtn>
              <ToolBtn onClick={() => exec('insertUnorderedList')} title="Bullet list"><List size={13} /></ToolBtn>
              <ToolBtn onClick={() => exec('indent')} title="Indent"><span style={{ fontSize: 12 }}>→</span></ToolBtn>
              <ToolBtn onClick={() => exec('outdent')} title="Outdent"><span style={{ fontSize: 12 }}>←</span></ToolBtn>
              <div style={s.sep} />
              <ToolBtn onClick={() => exec('formatBlock', 'blockquote')} title="Quote"><Quote size={13} /></ToolBtn>
              <ToolBtn onClick={() => exec('strikeThrough')} title="Strikethrough"><Strikethrough size={13} /></ToolBtn>
            </div>
          </div>
        </div>

        {/* Recipients Summary Footer */}
        {totalRecipients > 0 && (
          <div style={{ padding: '6px 40px', fontSize: 12, color: '#4caf50', borderTop: '1px solid #f0f0f0' }}>
            {totalRecipients} recipient{totalRecipients !== 1 ? 's' : ''} ready
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Styles ──────────────────────────────────────────────────── */
const composeStyles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 50,
    background: '#fff',
    display: 'flex', flexDirection: 'column',
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  page: {
    display: 'flex', flexDirection: 'column',
    height: '100%', overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 24px',
    borderBottom: '1px solid #f0f0f0',
  },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#111', fontSize: 18,
  },
  iconBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', padding: 6, borderRadius: 6,
    transition: 'background 0.15s',
  },
  sendLaterBtn: {
    padding: '8px 20px', borderRadius: 20,
    border: '1.5px solid #4caf50', background: 'transparent',
    color: '#4caf50', fontSize: 14, fontWeight: 600,
    cursor: 'pointer', transition: 'background 0.15s',
  },
  popoverCard: {
    position: 'absolute', top: 48, right: 0, zIndex: 100,
    width: 290, background: '#ffffff', borderRadius: 14,
    padding: '20px 20px 16px', boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
    border: '1px solid #eaeaea', display: 'flex', flexDirection: 'column', gap: 12,
  },
  popoverTitle: {
    fontSize: 16, fontWeight: 700, color: '#1a1d20', margin: 0,
  },
  dateInputContainer: {
    display: 'flex', alignItems: 'center', gap: 8,
    borderBottom: '1px solid #e5e7eb', paddingBottom: 6, margin: '4px 0',
  },
  dateTimeInput: {
    flex: 1, border: 'none', outline: 'none',
    fontSize: 13, color: '#4b5563', background: 'transparent',
    fontFamily: "'Inter', sans-serif", colorScheme: 'light',
  },
  formWrap: {
    flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column',
    padding: '8px 0',
  },
  row: {
    display: 'flex', alignItems: 'center',
    padding: '10px 40px', gap: 12, minHeight: 46,
  },
  label: {
    minWidth: 100, fontSize: 14, color: '#555', flexShrink: 0,
  },
  divider: {
    height: 1, background: '#f0f0f0', margin: '0 40px',
  },
  fromChipContainer: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 12px', borderRadius: 20,
    border: '1px solid #e0e0e0', background: '#fafafa',
  },
  fromInput: {
    border: 'none', outline: 'none', background: 'transparent',
    fontSize: 13, color: '#333', fontFamily: "'Inter', sans-serif",
    minWidth: 180,
  },
  uploadBtn: {
    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5,
    background: 'none', border: 'none', cursor: 'pointer',
    color: '#4caf50', fontSize: 13, fontWeight: 600, flexShrink: 0,
  },
  plainInput: {
    flex: 1, border: 'none', outline: 'none',
    fontSize: 14, color: '#333', background: 'transparent',
    fontFamily: "'Inter', sans-serif",
  },
  smallInput: {
    width: 64, padding: '4px 10px', border: '1px solid #e0e0e0',
    borderRadius: 8, fontSize: 13, color: '#333', outline: 'none',
    background: '#fafafa', textAlign: 'center',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
    padding: '8px 20px', borderTop: '1px solid #f0f0f0',
    background: '#fafafa',
  },
  sep: {
    width: 1, height: 18, background: '#e0e0e0', margin: '0 4px',
  },
};
