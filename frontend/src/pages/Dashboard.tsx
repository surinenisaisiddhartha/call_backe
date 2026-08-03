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
  const [contacts, setContacts] = useState<any[]>([]);
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [callbacks, setCallbacks] = useState<Callback[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const fetchAll = async () => {
    try {
      const [contactsRes, historyRes, apptRes, schedRes] = await Promise.all([
        api.get('/contacts'),
        api.get('/contacts/history/all'),
        api.get('/appointments'),
        api.get('/schedule'),
      ]);
      setContacts(contactsRes.data);
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
  const completedLeads = contacts.filter(c => c.status === 'Completed').length;

  const stats = [
    { label: 'Total Leads', value: contacts.length, color: 'var(--accent-primary)', icon: Users },
    { label: 'Calls Today', value: callsToday, color: 'var(--accent-secondary)', icon: PhoneCall },
    { label: 'Leads Completed', value: completedLeads, color: 'var(--accent-success)', icon: CheckCircle },
    { label: 'Appointments Booked', value: bookedAppointments.length, color: '#8b5cf6', icon: Calendar },
    { label: 'Callbacks Pending', value: pendingCallbacks.length, color: 'var(--accent-warning)', icon: Clock },
  ];

  const itemsPerPage = 12;
  const totalPages = Math.ceil(history.length / itemsPerPage);
  const recentCalls = history.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const upcoming = [
    ...bookedAppointments
      .filter(a => parseTs(a.scheduled_for) >= now)
      .map(a => ({
        id: a.id, contact_id: a.contact_id, contact_name: a.contact_name,
        when: a.scheduled_for, kind: 'Appointment' as const,
        detail: a.purpose || 'campus visit',
      })),
    ...pendingCallbacks
      .filter(c => parseTs(c.scheduled_for) >= now)
      .map(c => ({
        id: c.id, contact_id: c.contact_id, contact_name: c.contact_name,
        when: c.scheduled_for, kind: 'Callback' as const,
        detail: 'automatic follow-up call',
      })),
  ].sort((a, b) => parseTs(a.when) - parseTs(b.when)).slice(0, 8);

  const rowHover = {
    onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)'),
    onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => (e.currentTarget.style.background = 'transparent'),
  };

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  })();

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800 }}>
          {user?.school_name ? `${user.school_name} Dashboard` : 'Platform Dashboard'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
          Welcome back{user?.email ? `, ${user.email}` : ''}! Here is your live overview of calling activity, appointments, and follow-ups.
        </p>
      </div>

      {/* KPI stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: '16px', marginBottom: '28px' }}>
        {stats.map(s => (
          <div key={s.label} className="glass-panel" style={{ padding: '18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="icon-badge" style={{ background: `${s.color}18`, color: s.color }}>
              <s.icon size={20} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Two-column: recent activity + upcoming */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '20px', alignItems: 'start' }}>

        {/* Recent Call Activity */}
        <div className="glass-panel" style={{ padding: '20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 20px 14px', borderBottom: '1px solid var(--border-color)' }}>
            <Phone size={18} style={{ color: 'var(--accent-primary)' }} />
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700 }}>Recent Call Activity</h3>
          </div>

          <div style={{ maxHeight: 'calc(100vh - 380px)', minHeight: '380px', overflowY: 'auto' }}>
            {recentCalls.length === 0 ? (
              <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                No calls yet. Start a campaign to see activity here.
              </div>
            ) : recentCalls.map(rec => {
              const color = OUTCOME_COLORS[rec.outcome || ''] || '#6366f1';
              const label = rec.outcome ? (OUTCOME_LABELS[rec.outcome] || rec.outcome) : 'In Progress';
              return (
                <div
                  key={rec.id}
                  onClick={() => onViewContact?.(rec.contact_id)}
                  title="View this lead's full history, transcript & recording"
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', cursor: onViewContact ? 'pointer' : 'default', borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s' }}
                  {...rowHover}
                >
                  <div className="avatar-circle">{initials(rec.contact_name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {rec.contact_name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {rec.summary?.includes('appointment_booked') ? 'Booked an appointment'
                        : rec.summary?.includes('interested_followup_scheduled') ? 'Asked for a callback'
                        : rec.summary?.includes('do_not_call') ? 'Asked not to be called'
                        : rec.campaign_name || rec.contact_phone}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px', flexShrink: 0 }}>
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600, background: `${color}18`, color }}>
                      {label}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{timeAgo(rec.started_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px', padding: '12px 20px', borderTop: '1px solid var(--border-color)' }}>
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.8rem', minWidth: '80px', justifyContent: 'center' }}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="btn btn-secondary"
                style={{ padding: '4px 12px', fontSize: '0.8rem', minWidth: '80px', justifyContent: 'center' }}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Upcoming */}
        <div className="glass-panel" style={{ padding: '20px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 20px 14px', borderBottom: '1px solid var(--border-color)' }}>
            <CalendarCheck size={18} style={{ color: 'var(--accent-success)' }} />
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700 }}>Upcoming</h3>
          </div>

          {upcoming.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Nothing scheduled. Booked appointments and callbacks will appear here.
            </div>
          ) : upcoming.map(u => (
            <div
              key={`${u.kind}-${u.id}`}
              onClick={() => onViewContact?.(u.contact_id)}
              title="View this lead's full history"
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 20px', cursor: onViewContact ? 'pointer' : 'default', borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s' }}
              {...rowHover}
            >
              <div className="icon-badge" style={{
                width: '34px', height: '34px', borderRadius: '10px',
                background: u.kind === 'Appointment' ? 'rgba(139,92,246,0.15)' : 'rgba(245,158,11,0.15)',
                color: u.kind === 'Appointment' ? '#8b5cf6' : 'var(--accent-warning)',
              }}>
                {u.kind === 'Appointment' ? <Calendar size={16} /> : <Clock size={16} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {u.contact_name}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {u.kind === 'Appointment' ? u.detail : 'Automatic follow-up call'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {formatDateTime(u.when)}
                </span>
                {onViewContact && <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
