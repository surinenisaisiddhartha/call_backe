import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import {
  Users, CheckCircle, Phone, Calendar, Clock, RefreshCw,
  PhoneCall, CalendarCheck, ChevronRight, BarChart2
} from 'lucide-react';

interface CallRecord {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  outcome: string | null;
  duration_sec: number | null;
  started_at: string | null;
  summary: string | null;
  campaign_name: string;
}

interface Appointment {
  id: string;
  contact_id: string;
  contact_name: string;
  scheduled_for: string;
  purpose: string | null;
  status: string;
}

interface Callback {
  id: string;
  contact_id: string;
  contact_name: string;
  scheduled_for: string;
  status: string;
}

interface DashboardProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onViewContact?: (contactId: string) => void;
}

const OUTCOME_COLORS: Record<string, string> = {
  Answered: '#10b981',
  NoAnswer: '#f59e0b',
  Busy: '#f97316',
  Failed: '#ef4444',
  IncompleteHangup: '#f59e0b',
};

const OUTCOME_LABELS: Record<string, string> = {
  Answered: 'Answered',
  NoAnswer: 'No Answer',
  Busy: 'Busy',
  Failed: 'Failed',
  IncompleteHangup: 'Hung Up Early',
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const utcIso = (iso.endsWith('Z') || iso.includes('+') || (iso.split('-').length >= 4)) ? iso : `${iso}Z`;
  return new Date(utcIso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const utcIso = (iso.endsWith('Z') || iso.includes('+')) ? iso : `${iso}Z`;
  const diffMs = Date.now() - new Date(utcIso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

export default function Dashboard({ showToast, onViewContact }: DashboardProps) {
  const [loading, setLoading] = useState(true);
  // Tile counts come from the server. /contacts is paginated (200 max), so
  // counting a fetched array would report the page size, not the tenant.
  const [leadStats, setLeadStats] = useState<{ total: number; completed: number }>({ total: 0, completed: 0 });
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchAll = async () => {
    try {
      const [statsRes, historyRes, apptRes, schedRes] = await Promise.all([
        api.get('/contacts/stats'),
        api.get('/contacts/history/all'),
        api.get('/appointments'),
        api.get('/schedule'),
      ]);
      setLeadStats(statsRes.data);
      setHistory(historyRes.data);
      setAppointments(apptRes.data);
      setCallbacks(schedRes.data);
      setLoading(false);
    } catch (err) {
      console.error('Dashboard fetch failed', err);
      showToast(getErrorMessage(err, 'Failed to load dashboard data'), 'error');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <RefreshCw style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-primary)' }} size={40} />
      </div>
    );
  }

  const now = Date.now();
  const parseTs = (iso: string) => new Date((iso.endsWith('Z') || iso.includes('+')) ? iso : `${iso}Z`).getTime();

  const todayStartIST = (() => {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    nowIST.setHours(0, 0, 0, 0);
    return nowIST.getTime();
  })();

  const callsToday = history.filter(h => h.started_at && parseTs(h.started_at) >= todayStartIST).length;
  const bookedAppointments = appointments.filter(a => a.status === 'Booked');
  const pendingCallbacks = callbacks.filter(c => c.status === 'Scheduled');
  const completedLeads = leadStats.completed;

  const stats = [
    { label: 'Total Leads', value: leadStats.total, color: '#10b981', icon: Users, trend: `${leadStats.total} registered`, trendPositive: true },
    { label: 'Calls Today', value: callsToday, color: '#3b82f6', icon: PhoneCall, trend: callsToday > 0 ? `${callsToday} dialed today` : 'No calls today', trendPositive: callsToday > 0 },
    { label: 'Leads Completed', value: completedLeads, color: '#10b981', icon: CheckCircle, trend: `${completedLeads} completed`, trendPositive: true },
    { label: 'Appointments Booked', value: bookedAppointments.length, color: '#8b5cf6', icon: Calendar, trend: `${bookedAppointments.length} confirmed`, trendPositive: true },
    { label: 'Callbacks Pending', value: pendingCallbacks.length, color: '#f59e0b', icon: Clock, trend: pendingCallbacks.length > 0 ? `${pendingCallbacks.length} scheduled` : 'All cleared', trendPositive: pendingCallbacks.length === 0 },
  ];

  const itemsPerPage = 10;
  const totalPages = Math.ceil(history.length / itemsPerPage);
  const recentCalls = history.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const upcoming = [
    ...bookedAppointments
      .filter(a => parseTs(a.scheduled_for) >= now)
      .map(a => ({
        id: a.id, contact_id: a.contact_id, contact_name: a.contact_name,
        when: a.scheduled_for, kind: 'Appointment' as const,
        detail: a.purpose || 'Campus Visit',
      })),
    ...pendingCallbacks
      .filter(c => parseTs(c.scheduled_for) >= now)
      .map(c => ({
        id: c.id, contact_id: c.contact_id, contact_name: c.contact_name,
        when: c.scheduled_for, kind: 'Callback' as const,
        detail: 'Automatic follow-up call',
      })),
  ].sort((a, b) => parseTs(a.when) - parseTs(b.when)).slice(0, 8);

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            {user?.school_name ? `${user.school_name} Overview` : 'Admissions Overview'}
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '0.92rem' }}>
            Real-time telemetry on calling activity, student intent, and admissions conversion.
          </p>
        </div>
      </div>

      {/* KPI Stat Cards */}
      <div className="stats-grid">
        {stats.map(s => (
          <div key={s.label} className="glass-panel stat-card hover-lift" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <div className="stat-label" style={{ marginBottom: '8px' }}>{s.label}</div>
                <div className="stat-value">{s.value}</div>
              </div>
              <div style={{
                width: '42px', height: '42px', borderRadius: '10px',
                background: `${s.color}15`, color: s.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${s.color}30`,
                flexShrink: 0
              }}>
                <s.icon size={20} />
              </div>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center' }}>
              <span style={{
                fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                background: s.trendPositive ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                color: s.trendPositive ? '#10b981' : '#f59e0b',
                border: `1px solid ${s.trendPositive ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`
              }}>
                {s.trend}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Two-Column Activity & Upcoming Split */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '20px', alignItems: 'start' }}>

        {/* Recent Call Activity */}
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Phone size={18} style={{ color: 'var(--accent-primary)' }} />
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Recent Call Activity
              </h3>
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              {history.length} Total Dialed
            </span>
          </div>

          <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
            {recentCalls.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No call records yet. Start an outbound campaign to see live activity here.
              </div>
            ) : recentCalls.map(rec => {
              const color = OUTCOME_COLORS[rec.outcome || ''] || '#6366f1';
              const label = rec.outcome ? (OUTCOME_LABELS[rec.outcome] || rec.outcome) : 'In Progress';
              return (
                <div
                  key={rec.id}
                  onClick={() => onViewContact?.(rec.contact_id)}
                  title="Click to view lead details, audio, and transcript"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '14px',
                    padding: '14px 20px',
                    cursor: onViewContact ? 'pointer' : 'default',
                    borderBottom: '1px solid var(--border-color)',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(16, 185, 129, 0.04)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div className="avatar-circle">{initials(rec.contact_name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {rec.contact_name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                      {rec.summary?.includes('appointment_booked') ? '🎉 Booked an admissions visit'
                        : rec.summary?.includes('interested_followup_scheduled') ? '📞 Requested follow-up callback'
                        : rec.summary?.includes('do_not_call') ? '🚫 Requested not to be contacted'
                        : rec.campaign_name || rec.contact_phone}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '10px', fontSize: '0.7rem', fontWeight: 700,
                      background: `${color}18`, color, border: `1px solid ${color}35`
                    }}>
                      {label}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{timeAgo(rec.started_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-tertiary)' }}>
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.78rem' }}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                Page {currentPage} of {totalPages}
              </span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.78rem' }}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Upcoming Appointments & Callbacks */}
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CalendarCheck size={18} style={{ color: 'var(--accent-primary)' }} />
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Upcoming Appointments & Callbacks
              </h3>
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              {upcoming.length} Pending
            </span>
          </div>

          <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
            {upcoming.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No upcoming events scheduled. Confirmed campus visits and callbacks will appear here.
              </div>
            ) : upcoming.map(u => (
              <div
                key={`${u.kind}-${u.id}`}
                onClick={() => onViewContact?.(u.contact_id)}
                title="Click to view lead details"
                style={{
                  display: 'flex', alignItems: 'center', gap: '14px',
                  padding: '14px 20px',
                  cursor: onViewContact ? 'pointer' : 'default',
                  borderBottom: '1px solid var(--border-color)',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(16, 185, 129, 0.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px',
                  background: u.kind === 'Appointment' ? 'rgba(139,92,246,0.12)' : 'rgba(245,158,11,0.12)',
                  color: u.kind === 'Appointment' ? '#8b5cf6' : '#f59e0b',
                  border: `1px solid ${u.kind === 'Appointment' ? 'rgba(139,92,246,0.25)' : 'rgba(245,158,11,0.25)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0
                }}>
                  {u.kind === 'Appointment' ? <Calendar size={18} /> : <Clock size={18} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.contact_name}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                    {u.kind === 'Appointment' ? u.detail : 'Automatic follow-up callback'}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap', background: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                    {formatDateTime(u.when)}
                  </span>
                  {onViewContact && <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
