'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useScheduledEmails, useSentEmails } from '@/hooks/useEmails';
import { ComposeModal } from '@/components/ComposeModal';
import { EmailDetailModal } from '@/components/EmailDetailModal';
import { emailApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { EmailJob } from '@/types';
import { ExternalLink, X, Search, RotateCw, SlidersHorizontal, Clock, Send, ChevronDown, LogOut, Star, Calendar } from 'lucide-react';
import { format, startOfDay, endOfDay, subDays } from 'date-fns';

type ActiveTab = 'scheduled' | 'sent';

/* ── Helpers ──────────────────────────────────────────────────── */
function getInitials(name?: string | null) {
  if (!name) return '??';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatTimeBadge(dateStr: string) {
  const d = new Date(dateStr);
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${day} ${time}`;
}

function getBodyPreview(body: string, maxLen = 60) {
  const plain = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > maxLen ? plain.slice(0, maxLen) + '…' : plain;
}

function getBadgeColor(dateStr: string) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const colors: Record<number, string> = {
    0: '#e07b39', // Sun
    1: '#5b8ff9', // Mon
    2: '#e07b39', // Tue
    3: '#52c41a', // Wed
    4: '#722ed1', // Thu
    5: '#eb2f96', // Fri
    6: '#faad14', // Sat
  };
  return colors[day] ?? '#e07b39';
}

/* ── User Dropdown ───────────────────────────────────────────── */
function UserDropdown({ user, onLogout }: { user: { name?: string | null; email?: string; avatarUrl?: string | null }; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px 12px', borderRadius: 8, border: 'none',
          background: open ? '#f0faf0' : 'transparent',
          cursor: 'pointer', transition: 'background 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#f0faf0')}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Avatar */}
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={user.name ?? ''} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: '#4caf50',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0,
          }}>
            {getInitials(user.name)}
          </div>
        )}
        <div style={{ flex: 1, textAlign: 'left', overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.name ?? 'User'}
          </div>
          <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.email ?? ''}
          </div>
        </div>
        <ChevronDown size={14} color="#999" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#fff', border: '1px solid #e8e8e8', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)', marginTop: 4, overflow: 'hidden',
        }}>
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '10px 14px', border: 'none', background: 'transparent',
              cursor: 'pointer', fontSize: 13, color: '#333',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#fafafa')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <LogOut size={14} color="#666" />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Email Row ───────────────────────────────────────────────── */
function EmailRow({ email, type, onCancel, onClick }: { email: EmailJob; type: ActiveTab; onCancel?: (id: string) => Promise<void>; onClick: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [starred, setStarred] = useState(false);
  const [hovered, setHovered] = useState(false);
  const dateStr = type === 'scheduled' ? email.scheduled_at : (email.sent_at ?? email.scheduled_at);
  const badgeColor = getBadgeColor(dateStr);
  const recipientName = email.recipient_email.split('@')[0];

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onCancel) return;
    setCancelling(true);
    try { await onCancel(email.id); } finally { setCancelling(false); }
  };

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 20px',
        borderBottom: '1px solid #f0f0f0',
        background: hovered ? '#fafff9' : '#fff',
        cursor: 'pointer', transition: 'background 0.10s',
      }}
    >
      {/* To: Name */}
      <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', minWidth: 130, flexShrink: 0 }}>
        To: {recipientName.charAt(0).toUpperCase() + recipientName.slice(1)}
      </span>

      {/* Time badge */}
      <span style={{
        fontSize: 11, fontWeight: 600, color: '#fff',
        background: badgeColor, borderRadius: 20,
        padding: '3px 9px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <Clock size={10} />
        {formatTimeBadge(dateStr)}
      </span>

      {/* Subject */}
      <span style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', flexShrink: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {email.subject}
      </span>

      {/* Preview */}
      <span style={{ fontSize: 13, color: '#aaa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        · {getBodyPreview(email.body)}
      </span>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {email.preview_url && (
          <a href={email.preview_url} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 11, color: '#4caf50', display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none', padding: '2px 6px', borderRadius: 4, border: '1px solid #c8e6c9' }}
          >
            <ExternalLink size={10} /> Preview
          </a>
        )}
        {type === 'scheduled' && email.status === 'scheduled' && onCancel && (
          <button onClick={handleCancel} disabled={cancelling}
            style={{ fontSize: 11, color: '#f44336', display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: '1px solid #ffcdd2', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}
          >
            {cancelling ? '…' : <><X size={10} /> Cancel</>}
          </button>
        )}
        <button
          onClick={e => { e.stopPropagation(); setStarred(s => !s); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}
        >
          <Star size={15} color={starred ? '#faad14' : '#ccc'} fill={starred ? '#faad14' : 'none'} />
        </button>
      </div>
    </div>
  );
}

/* ── Skeleton Row ────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid #f0f0f0' }}>
      {[130, 90, 180, 260].map((w, i) => (
        <div key={i} style={{ height: 14, width: w, background: '#f0f0f0', borderRadius: 6, animation: 'pulse 1.5s infinite' }} />
      ))}
    </div>
  );
}

/* ── Dashboard Page ──────────────────────────────────────────── */
export default function DashboardPage() {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>('scheduled');
  const [composeOpen, setComposeOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailJob | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  // Date & Time Filter state
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const filterPopoverRef = useRef<HTMLDivElement>(null);

  const { emails: scheduledEmails, total: scheduledTotal, page: scheduledPage, isLoading: scheduledLoading, fetchScheduled, cancelEmail } = useScheduledEmails();
  const { emails: sentEmails, total: sentTotal, page: sentPage, isLoading: sentLoading, fetchSent } = useSentEmails();

  // Close filter popover on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterPopoverRef.current && !filterPopoverRef.current.contains(e.target as Node)) {
        setShowFilterPopover(false);
      }
    };
    if (showFilterPopover) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFilterPopover]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.replace('/login');
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (isAuthenticated) { fetchScheduled(1); fetchSent(1); }
  }, [isAuthenticated, fetchScheduled, fetchSent]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(() => {
      if (activeTab === 'scheduled') fetchScheduled(scheduledPage);
      else fetchSent(sentPage);
    }, 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, activeTab, scheduledPage, sentPage, fetchScheduled, fetchSent]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try { await Promise.all([fetchScheduled(scheduledPage), fetchSent(sentPage)]); }
    finally { setIsRefreshing(false); }
  }, [fetchScheduled, fetchSent, scheduledPage, sentPage]);

  const handleCancel = async (id: string) => {
    try { await cancelEmail(id); toast.success('Email cancelled'); }
    catch { toast.error('Failed to cancel email'); }
  };

  const handleDeleteEmail = async (id: string) => {
    try {
      await emailApi.delete(id);
      toast.success('Email deleted');
      fetchScheduled(scheduledPage);
      fetchSent(sentPage);
    } catch {
      toast.error('Failed to delete email');
    }
  };

  const handleComposeSuccess = useCallback(async (scheduledAt?: string) => {
    const isImmediate = scheduledAt && new Date(scheduledAt) <= new Date();
    if (isImmediate) {
      toast.success('Emails queued! Sending now — check Sent tab 📨');
      setTimeout(() => { setActiveTab('sent'); fetchSent(1); }, 3000);
    } else {
      toast.success('Emails scheduled successfully! 🚀');
    }
    fetchScheduled(1); fetchSent(1);
  }, [fetchScheduled, fetchSent]);

  // Apply Quick Date Filter Preset
  const applyQuickFilter = (preset: 'today' | 'week' | 'month') => {
    const now = new Date();
    const formatISO = (d: Date) => format(d, "yyyy-MM-dd'T'HH:mm");

    if (preset === 'today') {
      setFilterStartDate(formatISO(startOfDay(now)));
      setFilterEndDate(formatISO(endOfDay(now)));
    } else if (preset === 'week') {
      setFilterStartDate(formatISO(startOfDay(subDays(now, 7))));
      setFilterEndDate(formatISO(endOfDay(now)));
    } else if (preset === 'month') {
      setFilterStartDate(formatISO(startOfDay(subDays(now, 30))));
      setFilterEndDate(formatISO(endOfDay(now)));
    }
  };

  const activeEmails = activeTab === 'scheduled' ? scheduledEmails : sentEmails;

  // Filtered emails logic (search + date/time filter)
  const filtered = activeEmails.filter(e => {
    // 1. Text Search Filter
    const query = search.trim().toLowerCase();
    const matchesSearch = !query ||
      e.recipient_email.toLowerCase().includes(query) ||
      e.subject.toLowerCase().includes(query) ||
      e.body.toLowerCase().includes(query);

    // 2. Date & Time Range Filter
    const dateStr = activeTab === 'scheduled' ? e.scheduled_at : (e.sent_at ?? e.scheduled_at);
    const emailTimestamp = new Date(dateStr).getTime();

    let matchesStartDate = true;
    if (filterStartDate) {
      matchesStartDate = emailTimestamp >= new Date(filterStartDate).getTime();
    }

    let matchesEndDate = true;
    if (filterEndDate) {
      matchesEndDate = emailTimestamp <= new Date(filterEndDate).getTime();
    }

    return matchesSearch && matchesStartDate && matchesEndDate;
  });

  const isFilterActive = Boolean(filterStartDate || filterEndDate);

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
        <div style={{ width: 28, height: 28, border: '3px solid #e8f5e9', borderTop: '3px solid #4caf50', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const brand = (user?.name ?? 'Email').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 3);

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#fff', fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* ── Left Sidebar ─────────────────────────────────────── */}
      <aside style={{
        width: 200, flexShrink: 0, borderRight: '1px solid #f0f0f0',
        display: 'flex', flexDirection: 'column', padding: '16px 12px', gap: 0,
      }}>
        {/* Brand */}
        <div style={{ padding: '4px 12px 16px', fontSize: 22, fontWeight: 800, letterSpacing: -1, color: '#111' }}>
          {brand}
        </div>

        {/* User Dropdown */}
        <UserDropdown
          user={{ name: user?.name, email: user?.email, avatarUrl: user?.avatarUrl }}
          onLogout={logout}
        />

        {/* Compose Button */}
        <div style={{ padding: '12px 0' }}>
          <button
            id="compose-btn"
            onClick={() => setComposeOpen(true)}
            style={{
              width: '100%', padding: '8px 16px', borderRadius: 20,
              border: '1.5px solid #4caf50', background: 'transparent',
              color: '#4caf50', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f0faf0'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            Compose
          </button>
        </div>

        {/* Nav */}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', letterSpacing: 1, padding: '0 12px 8px', textTransform: 'uppercase' }}>
            Core
          </div>

          {/* Scheduled */}
          <button
            id="nav-scheduled"
            onClick={() => setActiveTab('scheduled')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 12px', borderRadius: 8, border: 'none',
              background: activeTab === 'scheduled' ? '#f0faf0' : 'transparent',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
          >
            <Clock size={15} color={activeTab === 'scheduled' ? '#4caf50' : '#666'} />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: activeTab === 'scheduled' ? 600 : 400, color: activeTab === 'scheduled' ? '#2d7a2d' : '#444' }}>
              Scheduled
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: activeTab === 'scheduled' ? '#4caf50' : '#999' }}>
              {scheduledTotal}
            </span>
          </button>

          {/* Sent */}
          <button
            id="nav-sent"
            onClick={() => setActiveTab('sent')}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%',
              padding: '8px 12px', borderRadius: 8, border: 'none',
              background: activeTab === 'sent' ? '#f0faf0' : 'transparent',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
          >
            <Send size={15} color={activeTab === 'sent' ? '#4caf50' : '#666'} />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 14, fontWeight: activeTab === 'sent' ? 600 : 400, color: activeTab === 'sent' ? '#2d7a2d' : '#444' }}>
              Sent
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: activeTab === 'sent' ? '#4caf50' : '#999' }}>
              {sentTotal}
            </span>
          </button>
        </div>
      </aside>

      {/* ── Main Content ──────────────────────────────────────── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 20px', borderBottom: '1px solid #f0f0f0', position: 'relative',
        }}>
          {/* Search */}
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={14} color="#bbb" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              type="text"
              placeholder="Search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px 8px 34px',
                border: '1px solid #e8e8e8', borderRadius: 20,
                fontSize: 13, color: '#333', outline: 'none',
                background: '#fafafa', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Filter Button */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowFilterPopover(s => !s)}
              style={{
                background: isFilterActive || showFilterPopover ? '#e8f5e9' : 'none',
                border: isFilterActive ? '1px solid #4caf50' : 'none',
                cursor: 'pointer', padding: 6, borderRadius: 6,
                color: isFilterActive ? '#4caf50' : '#aaa',
                display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
              }}
              title="Filter by Date & Time"
            >
              <SlidersHorizontal size={16} color={isFilterActive ? '#4caf50' : '#aaa'} />
              {isFilterActive && (
                <span style={{
                  position: 'absolute', top: 2, right: 2, width: 6, height: 6,
                  borderRadius: '50%', background: '#4caf50',
                }} />
              )}
            </button>

            {/* Filter Popover Menu */}
            {showFilterPopover && (
              <div ref={filterPopoverRef} style={{
                position: 'absolute', top: 38, right: 0, zIndex: 100,
                width: 280, background: '#ffffff', borderRadius: 12, padding: 16,
                boxShadow: '0 8px 30px rgba(0,0,0,0.12)', border: '1px solid #eaeaea',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={14} color="#4caf50" /> Filter by Date & Time
                  </span>
                  {isFilterActive && (
                    <button
                      onClick={() => { setFilterStartDate(''); setFilterEndDate(''); }}
                      style={{ fontSize: 11, color: '#f44336', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Reset
                    </button>
                  )}
                </div>

                {/* Quick presets */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => applyQuickFilter('today')}
                    style={{ padding: '4px 10px', borderRadius: 12, border: '1px solid #e0e0e0', background: '#fafafa', fontSize: 11, color: '#555', cursor: 'pointer' }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickFilter('week')}
                    style={{ padding: '4px 10px', borderRadius: 12, border: '1px solid #e0e0e0', background: '#fafafa', fontSize: 11, color: '#555', cursor: 'pointer' }}
                  >
                    This Week
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickFilter('month')}
                    style={{ padding: '4px 10px', borderRadius: 12, border: '1px solid #e0e0e0', background: '#fafafa', fontSize: 11, color: '#555', cursor: 'pointer' }}
                  >
                    This Month
                  </button>
                </div>

                {/* Date Inputs */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#666', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      From (Start Date & Time)
                    </label>
                    <input
                      type="datetime-local"
                      value={filterStartDate}
                      onChange={e => setFilterStartDate(e.target.value)}
                      style={{
                        width: '100%', padding: '6px 10px', border: '1px solid #e0e0e0',
                        borderRadius: 6, fontSize: 12, color: '#333', outline: 'none',
                        boxSizing: 'border-box', colorScheme: 'light',
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11, color: '#666', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      To (End Date & Time)
                    </label>
                    <input
                      type="datetime-local"
                      value={filterEndDate}
                      onChange={e => setFilterEndDate(e.target.value)}
                      style={{
                        width: '100%', padding: '6px 10px', border: '1px solid #e0e0e0',
                        borderRadius: 6, fontSize: 12, color: '#333', outline: 'none',
                        boxSizing: 'border-box', colorScheme: 'light',
                      }}
                    />
                  </div>
                </div>

                {/* Apply Button */}
                <button
                  type="button"
                  onClick={() => setShowFilterPopover(false)}
                  style={{
                    marginTop: 4, padding: '7px 12px', background: '#4caf50',
                    color: '#fff', border: 'none', borderRadius: 6, fontSize: 12,
                    fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s',
                  }}
                >
                  Apply Filters
                </button>
              </div>
            )}
          </div>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 6, color: '#aaa' }}
            title="Refresh"
          >
            <RotateCw size={16} style={{ animation: isRefreshing ? 'spin 0.8s linear infinite' : 'none' }} />
          </button>
        </div>

        {/* Filter Indicator Banner */}
        {isFilterActive && (
          <div style={{
            padding: '6px 20px', background: '#f0faf0', borderBottom: '1px solid #c8e6c9',
            fontSize: 12, color: '#2d7a2d', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>
              🔍 Filtering emails from <strong>{filterStartDate ? format(new Date(filterStartDate), 'MMM d, yyyy HH:mm') : 'Beginning'}</strong> to <strong>{filterEndDate ? format(new Date(filterEndDate), 'MMM d, yyyy HH:mm') : 'Now'}</strong>
            </span>
            <button
              onClick={() => { setFilterStartDate(''); setFilterEndDate(''); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f44336', fontSize: 11, fontWeight: 600 }}
            >
              Clear Filter ✕
            </button>
          </div>
        )}

        {/* Email List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {(activeTab === 'scheduled' ? scheduledLoading : sentLoading)
            ? [...Array(6)].map((_, i) => <SkeletonRow key={i} />)
            : filtered.length === 0
              ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: '#bbb', gap: 8 }}>
                  {activeTab === 'scheduled' ? <Clock size={36} /> : <Send size={36} />}
                  <p style={{ fontSize: 14 }}>
                    {search || isFilterActive ? 'No emails match your search / date filter' : activeTab === 'scheduled' ? 'No scheduled emails' : 'No sent emails yet'}
                  </p>
                  {(search || isFilterActive) && (
                    <button onClick={() => { setSearch(''); setFilterStartDate(''); setFilterEndDate(''); }}
                      style={{ marginTop: 4, padding: '4px 12px', background: 'none', border: '1px solid #ccc', color: '#666', borderRadius: 12, fontSize: 12, cursor: 'pointer' }}>
                      Clear Search & Filter
                    </button>
                  )}
                  {!search && !isFilterActive && activeTab === 'scheduled' && (
                    <button onClick={() => setComposeOpen(true)}
                      style={{ marginTop: 4, padding: '6px 16px', background: '#4caf50', color: '#fff', border: 'none', borderRadius: 20, fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
                      Schedule your first email
                    </button>
                  )}
                </div>
              )
              : filtered.map(email => (
                <EmailRow
                  key={email.id}
                  email={email}
                  type={activeTab}
                  onCancel={activeTab === 'scheduled' ? handleCancel : undefined}
                  onClick={() => setSelectedEmail(email)}
                />
              ))
          }
        </div>

        {/* Pagination */}
        {filtered.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#aaa' }}>
            <span>
              {activeTab === 'scheduled'
                ? `${filtered.length} of ${scheduledTotal} scheduled`
                : `${filtered.length} of ${sentTotal} sent`}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => activeTab === 'scheduled' ? fetchScheduled(scheduledPage - 1) : fetchSent(sentPage - 1)}
                disabled={activeTab === 'scheduled' ? scheduledPage <= 1 : sentPage <= 1}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e8e8e8', background: 'none', cursor: 'pointer', fontSize: 12, color: '#666', opacity: (activeTab === 'scheduled' ? scheduledPage <= 1 : sentPage <= 1) ? 0.3 : 1 }}
              >
                ← Prev
              </button>
              <span style={{ padding: '4px 8px', fontSize: 12 }}>
                Page {activeTab === 'scheduled' ? scheduledPage : sentPage}
              </span>
              <button
                onClick={() => activeTab === 'scheduled' ? fetchScheduled(scheduledPage + 1) : fetchSent(sentPage + 1)}
                disabled={activeTab === 'scheduled' ? scheduledPage * 50 >= scheduledTotal : sentPage * 50 >= sentTotal}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e8e8e8', background: 'none', cursor: 'pointer', fontSize: 12, color: '#666', opacity: (activeTab === 'scheduled' ? scheduledPage * 50 >= scheduledTotal : sentPage * 50 >= sentTotal) ? 0.3 : 1 }}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Compose Modal */}
      {composeOpen && <ComposeModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        onSuccess={handleComposeSuccess}
        userEmail={user?.email ?? ''}
        userName={user?.name ?? ''}
      />}

      {/* Email Detail View Modal */}
      <EmailDetailModal
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
        onDelete={handleDeleteEmail}
        currentUser={user}
      />
    </div>
  );
}
