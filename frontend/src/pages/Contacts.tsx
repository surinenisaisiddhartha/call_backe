import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import Pagination from '../components/Pagination';
import { Search, Phone, Calendar, History, X, Check, RefreshCw, CalendarRange, Trash2 } from 'lucide-react';

interface Contact {
  id: string;
  name: string;
  phone_number: string;
  email: string | null;
  notes: string | null;
  status: 'Pending' | 'Calling' | 'Completed' | 'NeedsReschedule' | 'Scheduled' | 'Failed';
  interest_level: 'HOT' | 'WARM' | 'COLD';
  lead_score: number;
  score_reasons: string[];
  parameter_scores?: Record<string, number>;
  weighted_score_breakdown?: Record<string, number>;
  classification_reason?: string;
  created_at: string;
}

interface CallAttempt {
  id: string;
  attempt_number: number;
  started_at: string;
  outcome: string;
  transcript: string | null;
  summary: string | null;
  duration_sec?: number | null;
  recording_url?: string | null;
  callback_raw_text?: string | null;
  detected_topics?: string[];
  user_sentiment?: string | null;
  call_successful?: string | null;
  analysis?: CallAnalysis | null;
}

/** Retell's structured post-call analysis. Every field is optional: it only
 *  exists for calls that ran after analysis was configured on the agent, so
 *  older calls simply have none. */
interface CallAnalysis {
  call_synopsis?: string;
  topics_discussed?: string;
  primary_topic?: string;
  engagement_quality?: 'Serious' | 'Casual' | 'NotInterested' | 'Unclear';
  interest_level?: 'Hot' | 'Warm' | 'Cold' | 'Unclear';
  caller_type?: string;
  concerns_raised?: string;
  recommended_next_step?: string;
}

interface Callback {
  id: string;
  scheduled_for: string;
  google_calendar_event_id: string | null;
  status: string;
}

interface ContactsProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  jumpToContactId?: string | null;
  onJumpHandled?: () => void;
  /** Arrives when a bucket is clicked on Call Insights. Applied once, then
   *  cleared via onClassificationHandled so it doesn't stick to the tab. */
  jumpToClassification?: string | null;
  onClassificationHandled?: () => void;
}

/**
 * Lead classification badge: HOT / WARM / COLD.
 *
 * Classification is purely score-driven using an 8-parameter weighted model.
 * 75–100 = HOT, 50–74.99 = WARM, 0–49.99 = COLD.
 */
/**
 * Circular SVG arc gauge for lead score — shows Cold/Warm/Hot arcs with
 * the current score as an animated needle overlay.
 */
function ScoreGauge({ score, level }: { score: number; level: string }) {
  const r = 70;
  const cx = 90;
  const cy = 90;
  const stroke = 12;
  const full = Math.PI * r;
  // Score 0-100 → arc fill 0-π (half circle)
  const fill = (Math.max(0, Math.min(100, score)) / 100) * full;

  const arcColor = level === 'HOT' ? '#f97316' : level === 'WARM' ? '#f59e0b' : '#94a3b8';

  const labelY = { HOT: '#dc2626', WARM: '#d97706', COLD: '#64748b' };
  const levelColor = labelY[level as keyof typeof labelY] || '#64748b';
  const levelEmoji = { HOT: '🔥', WARM: '🌡️', COLD: '❄️' }[level] || '';

  return (
    <div className="score-gauge-wrap">
      <svg width="180" height="100" viewBox="0 0 180 100">
        {/* Background arc */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#f1f5f9" strokeWidth={stroke} strokeLinecap="round"
        />
        {/* Cold zone (0-40) */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#e2e8f0" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${0.4 * full} ${full}`} strokeDashoffset={0}
        />
        {/* Warm zone (40-70) */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#fde68a" strokeWidth={stroke}
          strokeDasharray={`${0.3 * full} ${full}`} strokeDashoffset={-0.4 * full}
        />
        {/* Hot zone (70-100) */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#fed7aa" strokeWidth={stroke}
          strokeDasharray={`${0.3 * full} ${full}`} strokeDashoffset={-0.7 * full}
        />
        {/* Score fill arc */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={arcColor} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${fill} ${full}`} strokeDashoffset={0}
          style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />
        {/* Score label */}
        <text x={cx} y={cy - 8} textAnchor="middle" fontSize="28" fontWeight="800"
          fill={arcColor} fontFamily="Outfit, sans-serif">{score}</text>
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize="9" fontWeight="600"
          fill="#94a3b8" letterSpacing="1" fontFamily="Inter, sans-serif">LEAD SCORE</text>
        {/* Zone labels */}
        <text x={cx - r + 2} y={cy + 18} fontSize="8" fill="#94a3b8" fontFamily="Inter">Cold</text>
        <text x={cx - 8} y={cy + 18} fontSize="8" fill="#d97706" fontFamily="Inter">Warm</text>
        <text x={cx + r - 22} y={cy + 18} fontSize="8" fill="#ea580c" fontFamily="Inter">Hot</text>
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
        <span style={{ fontSize: '1.05rem' }}>{levelEmoji}</span>
        <span style={{ fontWeight: 700, fontSize: '0.92rem', color: levelColor }}>
          {level === 'HOT' ? 'Hot Lead' : level === 'WARM' ? 'Warm Lead' : 'Cold Lead'}
        </span>
      </div>
    </div>
  );
}

/**
 * Lead classification badge: HOT / WARM / COLD.
 */
function InterestBadge({ level, score, reasons }: { level: Contact['interest_level']; score?: number; reasons?: string[] }) {
  const styles: Record<string, { bg: string; fg: string; label: string; title: string }> = {
    'HOT':  { bg: '#fef2f2', fg: '#dc2626', label: 'HOT',  title: 'Score 75–100: Strong conversion, engagement, and interest signals' },
    'WARM': { bg: '#fffbeb', fg: '#d97706', label: 'WARM', title: 'Score 50–74: Moderate engagement, potential for conversion' },
    'COLD': { bg: '#f1f5f9', fg: '#64748b', label: 'COLD', title: 'Score 0–49: Low engagement or insufficient conversion signals' },
  };
  const s = styles[level] || styles['COLD'];
  const detail = reasons && reasons.length
    ? [s.title, '', `Score ${score}:`, ...reasons.map(r => `• ${r}`)].join(`\n`)
    : s.title;
  return (
    <span
      title={detail}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '3px 10px', borderRadius: '999px',
        background: s.bg, color: s.fg, fontSize: '0.75rem', fontWeight: 700,
        whiteSpace: 'nowrap', cursor: 'help', border: `1px solid ${s.bg}`,
      }}
    >
      {s.label}
      {typeof score === 'number' && (
        <span style={{ opacity: 0.75, fontWeight: 600 }}>{score}</span>
      )}
    </span>
  );
}

/**
 * The post-call analysis for one call: what was discussed, who we reached,
 * how interested they sounded, what held them back, and what to do next.
 *
 * Produced by Retell running an LLM over the finished transcript. The interest
 * rating here answers a different question from the Classification column in
 * the table: this is what the caller SAID on this one call, that is the
 * standing judgement across everything they have said and done.
 *
 * Every field renders only if present — a short or garbled call may produce
 * very little, and empty headings would be worse than nothing.
 */
function CallAnalysisPanel({ a, sentiment }: { a: CallAnalysis; sentiment?: string | null }) {
  const interestColour: Record<string, string> = {
    Hot: 'var(--accent-error)',
    Warm: 'var(--accent-warning)',
    Cold: 'var(--text-secondary)',
    Unclear: 'var(--text-muted)',
  };
  const engagementColour: Record<string, string> = {
    Serious: 'var(--accent-success)',
    Casual: '#a855f7',
    NotInterested: 'var(--text-secondary)',
    Unclear: 'var(--text-muted)',
  };
  const isNone = (v?: string) => !v || v.trim().toLowerCase() === 'none';

  const Row = ({ label, value }: { label: string; value?: string }) =>
    isNone(value) ? null : (
      <div style={{ marginTop: '8px' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
        <div style={{ fontSize: '0.85rem', marginTop: '2px' }}>{value}</div>
      </div>
    );

  const Pill = ({ text, colour, title }: { text: string; colour: string; title: string }) => (
    <span title={title} style={{
      padding: '2px 9px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700,
      color: colour, border: `1px solid ${colour}`,
    }}>{text}</span>
  );

  return (
    <div style={{
      background: 'rgba(124, 58, 237, 0.04)', border: '1px solid rgba(124, 58, 237, 0.12)',
      padding: '14px 16px', borderRadius: '12px', marginBottom: '12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.85rem' }}>Call analysis</strong>
        {a.interest_level && (
          <Pill text={`${a.interest_level} interest`} colour={interestColour[a.interest_level] || 'var(--text-muted)'}
                title="How interested they sounded on this call" />
        )}
        {a.engagement_quality && (
          <Pill text={a.engagement_quality} colour={engagementColour[a.engagement_quality] || 'var(--text-muted)'}
                title="How seriously they engaged — Casual means pleasant but not actually pursuing it" />
        )}
        {a.caller_type && (
          <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, background: 'rgba(124, 58, 237, 0.06)', color: 'var(--text-secondary)' }}
                title="Who we actually reached">{a.caller_type}</span>
        )}
        {a.primary_topic && a.primary_topic !== 'NoQuestions' && (
          <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, background: 'rgba(124, 58, 237, 0.06)', color: 'var(--text-secondary)' }}
                title="What they mainly came to ask about">{a.primary_topic}</span>
        )}
        {sentiment && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>sentiment: {sentiment}</span>
        )}
      </div>

      <Row label="What happened" value={a.call_synopsis} />
      <Row label="Topics discussed" value={a.topics_discussed} />
      <Row label="Concerns raised" value={a.concerns_raised} />
      <Row label="Suggested next step" value={a.recommended_next_step} />
    </div>
  );
}

export default function Contacts({ showToast, jumpToContactId, onJumpHandled, jumpToClassification, onClassificationHandled }: ContactsProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  // Server-side paging: `contacts` holds ONE page, and the total comes from
  // the API. Slicing a full list in the browser stopped being viable at
  // 1,000-10,000 leads a day — the response alone would run to megabytes.
  const [totalContacts, setTotalContacts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Seeded from the prop rather than set in an effect. Contacts mounts fresh
  // when you arrive from Call Insights, and effects run in declaration order:
  // an effect setting this AFTER mount would let the fetch effect fire first
  // with the old empty value, sending an unfiltered request that could resolve
  // last and overwrite the filtered results. Seeding means the first request
  // already carries the filter.
  const [interestFilter, setInterestFilter] = useState(jumpToClassification || '');

  // Still handle the prop arriving later (component already mounted).
  React.useEffect(() => {
    if (!jumpToClassification) return;
    setInterestFilter(jumpToClassification);
    onClassificationHandled?.();
  }, [jumpToClassification]);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  
  // Reschedule Modal State
  const [rescheduleContact, setRescheduleContact] = useState<Contact | null>(null);
  const [scheduledFor, setScheduledFor] = useState('');
  const [rescheduling, setRescheduling] = useState(false);



  // History Drawer State
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [attempts, setAttempts] = useState<CallAttempt[]>([]);
  const [schedules, setSchedules] = useState<Callback[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  // The lead's standing judgement, shown at the top of the drawer so the
  // reader doesn't have to reconstruct it from a list of calls.
  const [leadSummary, setLeadSummary] = useState<{
    classification: string; score: number; reasons: string[]; topics: string[];
    parameterScores?: Record<string, number>;
    weightedBreakdown?: Record<string, number>;
    classificationReason?: string;
  } | null>(null);

  // Changing a filter resets to page 1; the fetch effect below then runs once
  // for the new combination. Kept separate so a filter change doesn't fetch
  // twice (once for the filter, once for the page reset).
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, interestFilter]);

  useEffect(() => {
    fetchContacts();
  }, [search, statusFilter, interestFilter, currentPage, pageSize]);

  useEffect(() => {
    if (jumpToContactId) {
      viewHistoryById(jumpToContactId);
      onJumpHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToContactId]);

  // Guards against out-of-order responses: typing quickly or changing filters
  // leaves several requests in flight, and the slowest one arriving last would
  // otherwise overwrite newer results with stale ones.
  const fetchSeq = React.useRef(0);

  const fetchContacts = async () => {
    const seq = ++fetchSeq.current;
    try {
      const res = await api.get('/contacts', {
        params: {
          search,
          status: statusFilter || undefined,
          interest: interestFilter || undefined,
          page: currentPage,
          page_size: pageSize,
        },
      });
      if (seq !== fetchSeq.current) return;   // a newer request already won
      setContacts(res.data.items || []);
      setTotalContacts(res.data.total || 0);
      setLoading(false);
    } catch (err: any) {
      if (seq !== fetchSeq.current) return;
      console.error('Error fetching contacts:', err);
      setLoading(false);
    }
  };



  const formatDateTime = (iso: string | null | undefined): string => {
    if (!iso) return '—';
    const utcIso = (iso.endsWith('Z') || iso.includes('+') || (iso.split('-').length >= 4)) ? iso : `${iso}Z`;
    return new Date(utcIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
  };

  const callNow = async (contactId: string, name: string) => {
    try {
      await api.post(`/calls/${contactId}/call-now`);
      showToast(`Call initiated to ${name}!`, 'success');
      fetchContacts();
    } catch (err: any) {
      showToast(getErrorMessage(err, 'Failed to trigger call'), 'error');
    }
  };

  const openRescheduleModal = (contact: Contact) => {
    setRescheduleContact(contact);
    // Default to tomorrow same time
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduledFor(tomorrow.toISOString().slice(0, 16));
  };

  const submitReschedule = async () => {
    if (!rescheduleContact) return;
    setRescheduling(true);
    try {
      await api.post('/schedule', {
        contactId: rescheduleContact.id,
        scheduledFor,
      });
      showToast(`Follow-up scheduled for ${rescheduleContact.name}`, 'success');
      setRescheduleContact(null);
      fetchContacts();
    } catch (err: any) {
      showToast(getErrorMessage(err, 'Failed to schedule callback'), 'error');
    } finally {
      setRescheduling(false);
    }
  };

  const viewHistory = async (contact: Contact) => {
    setSelectedContact(contact);
    setLoadingHistory(true);
    try {
      const res = await api.get(`/contacts/${contact.id}`);
      setAttempts(res.data.attempts || []);
      setSchedules(res.data.schedules || []);
      setLeadSummary({
        classification: res.data.classification,
        score: res.data.lead_score,
        reasons: res.data.score_reasons || [],
        topics: res.data.topics_asked || [],
        parameterScores: res.data.parameter_scores || {},
        weightedBreakdown: res.data.weighted_score_breakdown || {},
        classificationReason: res.data.classification_reason || '',
      });
    } catch (err) {
      showToast('Failed to load history', 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  // Opens the history drawer for a contact we don't already have loaded
  // (e.g. jumped to from another page's call-history table by contact_id only).
  const viewHistoryById = async (contactId: string) => {
    setLoadingHistory(true);
    try {
      const res = await api.get(`/contacts/${contactId}`);
      setSelectedContact(res.data.contact);
      setAttempts(res.data.attempts || []);
      setSchedules(res.data.schedules || []);
      setLeadSummary({
        classification: res.data.classification,
        score: res.data.lead_score,
        reasons: res.data.score_reasons || [],
        topics: res.data.topics_asked || [],
        parameterScores: res.data.parameter_scores || {},
        weightedBreakdown: res.data.weighted_score_breakdown || {},
        classificationReason: res.data.classification_reason || '',
      });
    } catch (err) {
      showToast('Failed to load contact history', 'error');
    } finally {
      setLoadingHistory(false);
    }
  };

  const deleteContact = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete ${name}? This cannot be undone.`)) return;
    try {
      await api.delete(`/contacts/${id}`);
      showToast('Contact deleted successfully', 'success');
      fetchContacts();
    } catch (err) {
      showToast('Failed to delete contact', 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800 }}>Lead Directory</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Search and manage prospective student outreach actions</p>
        </div>
      </div>

      {/* Filter and search bar */}
      <div className="glass-panel" style={{ display: 'flex', gap: '16px', marginBottom: '24px', padding: '16px' }}>
        <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '8px 16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <Search size={18} style={{ color: 'var(--text-secondary)' }} />
          <input 
            type="text" 
            placeholder="Search by name or phone number..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: 'none', border: 'none', color: 'var(--text-primary)', outline: 'none', width: '100%', fontSize: '0.95rem' }}
          />
        </div>
        
        <select 
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="form-input"
          style={{ width: '180px' }}
        >
          <option value="">All Statuses</option>
          <option value="Pending">Pending</option>
          <option value="Calling">Calling</option>
          <option value="Completed">Completed</option>
          <option value="NeedsReschedule">Needs Reschedule</option>
          <option value="Scheduled">Scheduled</option>
          <option value="Failed">Failed</option>
        </select>

        <select
          value={interestFilter}
          onChange={(e) => setInterestFilter(e.target.value)}
          className="form-input"
          style={{ width: '170px' }}
          title="Lead classification based on weighted scoring"
        >
          <option value="">All Callers</option>
          <option value="HOT">HOT</option>
          <option value="WARM">WARM</option>
          <option value="COLD">COLD</option>
        </select>
      </div>

      {/* Table grid */}
      {loading ? (
        <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <RefreshCw className="animate-spin" style={{ animation: 'spin 2s linear infinite' }} size={24} />
          <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Loading contacts...</p>
        </div>
      ) : contacts.length === 0 ? (
        <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <Phone size={48} style={{ color: 'var(--text-muted)', opacity: 0.5, marginBottom: '16px' }} />
          <h3>No Contacts Found</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>
            There are no contacts matching your current filters.
          </p>
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div className="table-container" style={{ flex: 1 }}>
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone Number</th>
                  <th>Status</th>
                  <th>Classification</th>
                  <th>Email</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div className="avatar-circle">
                          {c.name.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase()}
                        </div>
                        {c.name}
                      </div>
                    </td>
                    <td>{c.phone_number}</td>
                    <td>
                      <span className={`badge badge-${c.status.toLowerCase().replace(/\s+/g, '')}`}>
                        {c.status}
                      </span>
                    </td>
                    <td><InterestBadge level={c.interest_level} score={c.lead_score} reasons={c.score_reasons} /></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{c.email || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          onClick={() => callNow(c.id, c.name)}
                          disabled={c.status === 'Calling'}
                        >
                          <Phone size={14} />
                          Call
                        </button>
                        
                        {/* Always rendered (hidden when N/A) so buttons align vertically across rows */}
                        <button
                          className="btn btn-primary"
                          style={{ padding: '6px 12px', fontSize: '0.8rem', visibility: c.status === 'NeedsReschedule' ? 'visible' : 'hidden' }}
                          onClick={() => openRescheduleModal(c)}
                          tabIndex={c.status === 'NeedsReschedule' ? 0 : -1}
                        >
                          <Calendar size={14} />
                          Reschedule
                        </button>

                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                          onClick={() => viewHistory(c)}
                        >
                          <History size={14} />
                          History
                        </button>
                        
                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '6px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)' }}
                          onClick={() => deleteContact(c.id, c.name)}
                          title="Delete Contact"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            currentPage={currentPage}
            totalItems={totalContacts}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleContact && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ padding: '30px', maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '4px' }}>
                  Reschedule: {rescheduleContact.name}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{rescheduleContact.phone_number}</p>
              </div>
              <button onClick={() => setRescheduleContact(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">Follow-up Date & Time</label>
              <input
                type="datetime-local"
                className="form-input"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setRescheduleContact(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={submitReschedule}
                disabled={rescheduling}
              >
                {rescheduling ? 'Booking...' : 'Confirm Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Slide-out Drawer */}
      {selectedContact && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            width: '520px',
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(20px)',
            borderLeft: '1px solid rgba(124, 58, 237, 0.12)',
            boxShadow: '-8px 0 40px rgba(124, 58, 237, 0.08)',
            zIndex: 1050,
            padding: '32px',
            overflowY: 'auto',
            transition: 'var(--transition-smooth)'
          }}
        >
          {/* Response AI CRM style header */}
          <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid var(--border-color)' }}>
            {/* Back button */}
            <button
              onClick={() => setSelectedContact(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '10px', padding: 0 }}
            >
              ← All leads
            </button>

            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Call with{' '}
                  <span style={{ color: 'var(--accent-primary)' }}>{selectedContact.name}</span>
                </h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {selectedContact.phone_number}
                </div>
              </div>
              <button
                onClick={() => setSelectedContact(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Status pills */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
              <span className="call-status-pill" style={{ background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0' }}>
                <span className="call-status-pill-dot" style={{ background: '#22c55e' }} />
                Completed
              </span>
              {leadSummary && (
                <span className="call-status-pill" style={{ background: '#f5f3ff', color: '#7c3aed', borderColor: '#ddd6fe' }}>
                  <span className="call-status-pill-dot" style={{ background: '#7c3aed' }} />
                  {leadSummary.classification === 'HOT' ? 'Priority Callback' : 'Counselling Callback'}
                </span>
              )}
              {leadSummary && (
                <span className="call-status-pill" style={{ background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0' }}>
                  {leadSummary.classification === 'HOT' ? '🔥 Hot' : leadSummary.classification === 'WARM' ? '🌡️ Warm' : '❄️ Cold'}
                </span>
              )}
            </div>

            {/* Call meta strip */}
            {attempts.length > 0 && (
              <div className="call-meta-row">
                <div className="call-meta-item">
                  <label>STARTED</label>
                  <span>{formatDateTime(attempts[0].started_at)}</span>
                </div>
                <div className="call-meta-item">
                  <label>DURATION</label>
                  <span>{attempts[0].duration_sec ? `${attempts[0].duration_sec}s` : '—'}</span>
                </div>
                <div className="call-meta-item">
                  <label>DESTINATION</label>
                  <span>📞 {selectedContact.phone_number}</span>
                </div>
                <div className="call-meta-item">
                  <label>AGENT</label>
                  <span>AI Agent</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '28px', borderBottom: '1px solid rgba(124, 58, 237, 0.10)', paddingBottom: '18px', lineHeight: 1.7 }}>
            <div>Phone: {selectedContact.phone_number}</div>
            <div>Email: {selectedContact.email || 'None'}</div>
            <div style={{ marginTop: '8px' }}>Notes: {selectedContact.notes || 'No custom notes.'}</div>
          </div>

          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '16px' }}>Outbound History</h4>

          {/* Call detail: Response AI CRM style */}
          {!loadingHistory && leadSummary && (() => {
            const paramScores = leadSummary.parameterScores || {};
            const weightedBreakdown = leadSummary.weightedBreakdown || {};
            const totalWeighted = Object.values(weightedBreakdown).reduce((a, b) => a + b, 0);
            const lastAttempt = attempts[0];
            const nextAction = lastAttempt?.analysis?.recommended_next_step || leadSummary.classificationReason;

            // Build parameter labels
            const PARAM_LABELS: Record<string, string> = {
              stated_interest: 'Stated interest',
              preference_for_us: 'Preference for us',
              urgency: 'Urgency',
              counsellor_requested: 'Counsellor requested',
              engagement: 'Engagement',
              application_progress: 'Application progress',
              sentiment: 'Sentiment',
              follow_up_intent: 'Follow-up intent',
            };

            const PARAM_VALUE_LABELS: Record<string, Record<number, string>> = {
              stated_interest: { 4: 'Interested', 2: 'Curious', 0: 'None' },
              preference_for_us: { 4: 'First Choice', 2: 'Considering', 0: 'None' },
              urgency: { 3: 'Within 30 Days', 2: 'Next Semester', 1: 'Exploring', 0: 'None' },
              counsellor_requested: { 3: 'Yes', 0: 'No' },
              engagement: { 3: 'Highly Engaged', 2: 'Moderately Engaged', 1: 'Low', 0: 'Not Engaged' },
              application_progress: { 3: 'Applied', 2: 'In Progress', 1: 'Not Started', 0: 'None' },
            };

            return (
              <div style={{ marginBottom: '20px' }}>
                {/* Two-column: gauge left, bars right */}
                <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '16px', alignItems: 'start' }}>
                  {/* Score gauge */}
                  <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '12px 8px' }}>
                    <ScoreGauge score={leadSummary.score} level={leadSummary.classification} />
                    {leadSummary.classificationReason && (
                      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: '10px', padding: '0 4px', textAlign: 'center' }}>
                        {leadSummary.classificationReason}
                      </p>
                    )}
                    {/* Cold/Warm/Hot legend pills */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '12px' }}>
                      {(['Cold', 'Warm', 'Hot'] as const).map(tier => (
                        <div key={tier} style={{
                          padding: '4px 8px', borderRadius: '6px', fontSize: '0.68rem', fontWeight: 600, textAlign: 'center', lineHeight: 1.3,
                          background: tier === 'Hot' && leadSummary.classification === 'HOT' ? '#ea580c'
                            : tier === 'Warm' && leadSummary.classification === 'WARM' ? '#f59e0b'
                            : tier === 'Cold' && leadSummary.classification === 'COLD' ? '#64748b' : '#f1f5f9',
                          color: (
                            (tier === 'Hot' && leadSummary.classification === 'HOT') ||
                            (tier === 'Warm' && leadSummary.classification === 'WARM') ||
                            (tier === 'Cold' && leadSummary.classification === 'COLD')
                          ) ? 'white' : 'var(--text-muted)',
                        }}>
                          {tier}
                          <div style={{ opacity: 0.8, fontSize: '0.6rem', fontWeight: 400 }}>
                            {tier === 'Cold' ? 'Low priority' : tier === 'Warm' ? 'Nurture & follow up' : 'Call immediately'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Parameter score bars */}
                  <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>What drove this score</span>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>bar width = weight × fill = earned</span>
                    </div>

                    {Object.keys(paramScores).length > 0 ? Object.entries(paramScores).map(([key, rawVal]) => {
                      const val = rawVal as number;
                      const weighted = weightedBreakdown[key] || 0;
                      const label = PARAM_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                      const paramMax = Math.max(...Object.values(paramScores).map(v => v as number), 1);
                      const barPct = Math.round((val / paramMax) * 100);
                      const valueLabel = PARAM_VALUE_LABELS[key]?.[val] ?? String(val);
                      return (
                        <div className="score-param-bar-row" key={key}>
                          <span className="score-param-label">{label}</span>
                          <div className="score-param-bar-track">
                            <div className="score-param-bar-fill" style={{ width: `${barPct}%` }} />
                          </div>
                          <span className="score-param-value-label">{valueLabel}</span>
                          <span className="score-param-points">+{typeof weighted === 'number' ? Math.round(weighted * 10) / 10 : weighted}</span>
                        </div>
                      );
                    }) : (
                      leadSummary.reasons.length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {leadSummary.reasons.map((r, i) => (
                            <li key={i} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r}</li>
                          ))}
                        </ul>
                      )
                    )}

                    {/* Recommended next action */}
                    {nextAction && (
                      <div className="rec-action-box">
                        <div className="rec-action-label">
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg>
                          RECOMMENDED NEXT ACTION
                        </div>
                        <div className="rec-action-text">{nextAction}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Topics asked about */}
                {leadSummary.topics.length > 0 && (
                  <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Has asked about:</span>
                    {leadSummary.topics.map(topic => (
                      <span key={topic} style={{
                        padding: '3px 10px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                        background: 'rgba(34, 197, 94, 0.08)', color: 'var(--accent-primary)',
                        border: '1px solid rgba(34, 197, 94, 0.2)',
                      }}>{topic}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {loadingHistory ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <RefreshCw className="animate-spin" style={{ animation: 'spin 2s linear infinite' }} size={20} />
            </div>
          ) : (
            <div className="timeline">
              {attempts.map((attempt) => (
                <div className="timeline-item" key={attempt.id}>
                  <div className="timeline-marker">
                    <div className="timeline-dot" />
                    <div className="timeline-line" />
                  </div>
                  <div className="timeline-content">
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      <span>Attempt #{attempt.attempt_number}</span>
                      <span>{formatDateTime(attempt.started_at)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                      <span className={`badge badge-${(attempt.outcome || 'calling').toLowerCase()}`}>
                        {attempt.outcome || 'Calling'}
                      </span>
                      {attempt.duration_sec && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          • {Math.floor(attempt.duration_sec / 60)}m {Math.floor(attempt.duration_sec % 60)}s
                        </span>
                      )}
                    </div>

                    {attempt.recording_url && (
                      <div style={{ marginBottom: '12px' }}>
                        <audio controls src={attempt.recording_url} style={{ height: '32px', width: '100%' }} preload="none" />
                      </div>
                    )}

                    {attempt.callback_raw_text && (
                      <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '12px', borderLeft: '3px solid #f59e0b' }}>
                        <strong>Callback Requested:</strong> "{attempt.callback_raw_text}"
                      </div>
                    )}

                    {attempt.analysis && <CallAnalysisPanel a={attempt.analysis} sentiment={attempt.user_sentiment} />}

                    {/* Detected from the caller's own words. Shown separately
                        from the analysis panel because it exists for every
                        call, including ones made before analysis was set up. */}
                    {attempt.detected_topics && attempt.detected_topics.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Asked about:</span>
                        {attempt.detected_topics.map(topic => (
                          <span key={topic} style={{
                            padding: '3px 9px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600,
                            background: 'rgba(124, 58, 237, 0.08)', color: 'var(--accent-primary)',
                            border: '1px solid rgba(124, 58, 237, 0.12)',
                          }}>{topic}</span>
                        ))}
                      </div>
                    )}

                    {attempt.summary && (
                      <div style={{ background: 'rgba(124, 58, 237, 0.03)', padding: '12px', borderRadius: '10px', fontSize: '0.85rem', marginBottom: '12px', borderLeft: '3px solid var(--accent-primary)' }}>
                        <strong>Summary:</strong> {attempt.summary}
                      </div>
                    )}

                    {attempt.transcript && (
                      <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '10px', maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color)' }}>
                        {attempt.transcript}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {schedules.filter(s => s.status === 'Scheduled').map((sched) => (
                <div className="timeline-item" key={sched.id}>
                  <div className="timeline-marker">
                    <div className="timeline-dot" style={{ background: 'var(--accent-secondary)', boxShadow: '0 0 8px var(--accent-secondary)' }} />
                    <div className="timeline-line" style={{ borderStyle: 'dashed' }} />
                  </div>
                  <div className="timeline-content" style={{ border: '1px dashed var(--accent-secondary)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Scheduled Callback
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                      {formatDateTime(sched.scheduled_for)}
                    </div>
                    {sched.google_calendar_event_id && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', marginTop: '8px' }}>
                        ✓ Google Calendar sync active
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {attempts.length === 0 && schedules.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '20px' }}>
                  No call attempts or future schedules yet.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
