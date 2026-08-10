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
  interest_level: 'Hot Lead' | 'Warm Lead' | 'Time Pass' | 'Not Interested' | 'Unclassified' | 'Not Reached';
  lead_score: number;
  score_reasons: string[];
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
 * How interested a caller looked, in three levels.
 *
 * Derived on the server from what the lead actually DID — booked an
 * appointment, asked for a callback, or neither — rather than from a rating
 * the voice agent had to remember to give. "Unrated" is deliberately its own
 * case rather than being lumped in with Cold: an unanswered call or a wrong
 * number says nothing about interest, and showing those as Cold would bury
 * parents nobody has managed to speak to yet.
 */
/**
 * One label per caller: is this person worth another call?
 *
 * "Time Pass" is the one that earns its place — those callers answer, chat
 * politely, and often accept a callback just to end the conversation, so in
 * every other view they look identical to a good lead. Only the conversation
 * itself separates them.
 *
 * Computed on the server from the same rule the Insights page uses, so the
 * two screens can never disagree.
 */
function InterestBadge({ level, score, reasons }: { level: Contact['interest_level']; score?: number; reasons?: string[] }) {
  const styles: Record<string, { bg: string; fg: string; label: string; title: string }> = {
    'Hot Lead':       { bg: 'rgba(239, 68, 68, 0.12)',   fg: 'var(--accent-error)',   label: '🔥 Hot Lead',   title: 'Booked, or sounded genuinely ready' },
    'Warm Lead':      { bg: 'rgba(245, 158, 11, 0.14)',  fg: 'var(--accent-warning)', label: '🟡 Warm Lead',  title: 'Real interest, not ready to commit yet' },
    'Time Pass':      { bg: 'rgba(168, 85, 247, 0.14)',  fg: '#a855f7',               label: '⏳ Time Pass',  title: 'Engaged politely but is not actually pursuing it' },
    'Not Interested': { bg: 'rgba(100, 116, 139, 0.14)', fg: 'var(--text-secondary)', label: 'Not Interested', title: 'Said no, or asked not to be contacted' },
    'Unclassified':   { bg: 'rgba(59, 130, 246, 0.10)',  fg: 'var(--accent-primary)', label: 'Unclassified',  title: 'We spoke to them, but this call has no analysis yet — no verdict either way' },
    'Not Reached':    { bg: 'transparent',               fg: 'var(--text-muted)',     label: '—',             title: 'No real conversation yet — nothing to judge' },
  };
  const s = styles[level] || styles['Not Reached'];
  // The reasons ride along in the tooltip: a bare number invites blind trust
  // or blanket dismissal, and "booked an appointment (+45)" is checkable.
  const detail = reasons && reasons.length
    ? [s.title, '', `Score ${score}:`, ...reasons.map(r => `• ${r}`)].join(`
`)
    : s.title;
  return (
    <span
      title={detail}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '3px 10px', borderRadius: '999px',
        background: s.bg, color: s.fg, fontSize: '0.78rem', fontWeight: 700,
        whiteSpace: 'nowrap', cursor: 'help',
      }}
    >
      {s.label}
      {typeof score === 'number' && level !== 'Not Reached' && (
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
          title="How interested the caller seemed, based on what they did"
        >
          <option value="">All Callers</option>
          <option value="Hot Lead">🔥 Hot Lead</option>
          <option value="Warm Lead">🟡 Warm Lead</option>
          <option value="Time Pass">⏳ Time Pass</option>
          <option value="Not Interested">Not Interested</option>
          <option value="Unclassified">Unclassified</option>
          <option value="Not Reached">— Not Reached</option>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 700 }}>
              {selectedContact.name}
            </h3>
            <button 
              onClick={() => setSelectedContact(null)} 
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>
          </div>

          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '28px', borderBottom: '1px solid rgba(124, 58, 237, 0.10)', paddingBottom: '18px', lineHeight: 1.7 }}>
            <div>Phone: {selectedContact.phone_number}</div>
            <div>Email: {selectedContact.email || 'None'}</div>
            <div style={{ marginTop: '8px' }}>Notes: {selectedContact.notes || 'No custom notes.'}</div>
          </div>

          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '16px' }}>Outbound History</h4>

          {/* The standing judgement for this lead, above the call list. The
              calls are the evidence; this is the conclusion — and the reasons
              are spelled out rather than hidden in a tooltip, so it can be
              checked at a glance. */}
          {!loadingHistory && leadSummary && (
            <div style={{
              background: 'rgba(124, 58, 237, 0.04)', border: '1px solid rgba(124, 58, 237, 0.12)',
              borderRadius: '14px', padding: '18px', marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <InterestBadge level={leadSummary.classification as Contact['interest_level']} />
                <span style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1, color: 'var(--accent-primary)' }}>
                  {leadSummary.score}
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}> /100</span>
                </span>
              </div>

              {leadSummary.reasons.length > 0 && (
                <ul style={{ margin: '14px 0 0', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {leadSummary.reasons.map((r, i) => (
                    <li key={i} style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{r}</li>
                  ))}
                </ul>
              )}

              {leadSummary.topics.length > 0 && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                    Has asked about
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {leadSummary.topics.map(topic => (
                      <span key={topic} style={{
                        padding: '3px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
                        background: 'rgba(124, 58, 237, 0.06)', color: 'var(--accent-primary)',
                        border: '1px solid rgba(124, 58, 237, 0.12)',
                      }}>{topic}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

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
