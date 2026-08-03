import React, { useEffect, useState } from 'react';
import api from '../api';
import Pagination from '../components/Pagination';
import { Search, Phone, Calendar, History, X, Check, RefreshCw, CalendarRange, Trash2 } from 'lucide-react';

interface Contact {
  id: string;
  name: string;
  phone_number: string;
  email: string | null;
  notes: string | null;
  status: 'Pending' | 'Calling' | 'Completed' | 'NeedsReschedule' | 'Scheduled' | 'Failed';
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
}

export default function Contacts({ showToast, jumpToContactId, onJumpHandled }: ContactsProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
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

  useEffect(() => {
    fetchContacts();
    setCurrentPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (jumpToContactId) {
      viewHistoryById(jumpToContactId);
      onJumpHandled?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToContactId]);

  const fetchContacts = async () => {
    try {
      const res = await api.get('/contacts', {
        params: {
          search,
          status: statusFilter || undefined,
        },
      });
      setContacts(res.data);
      setLoading(false);
    } catch (err: any) {
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
      showToast(err.response?.data?.error || 'Failed to trigger call', 'error');
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
      showToast(err.response?.data?.detail || err.response?.data?.error || 'Failed to schedule callback', 'error');
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
                  <th>Email</th>
                  <th style={{ textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contacts.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((c) => (
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
            totalItems={contacts.length}
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
            width: '500px',
            background: 'var(--sidebar-bg)',
            backdropFilter: 'blur(30px)',
            borderLeft: '1px solid var(--border-color)',
            boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
            zIndex: 1050,
            padding: '30px',
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

          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '30px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
            <div>Phone: {selectedContact.phone_number}</div>
            <div>Email: {selectedContact.email || 'None'}</div>
            <div style={{ marginTop: '8px' }}>Notes: {selectedContact.notes || 'No custom notes.'}</div>
          </div>

          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '16px' }}>Outbound History</h4>

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

                    {attempt.summary && (
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '12px', borderLeft: '3px solid var(--accent-primary)' }}>
                        <strong>Summary:</strong> {attempt.summary}
                      </div>
                    )}

                    {attempt.transcript && (
                      <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '6px', maxHeight: '150px', overflowY: 'auto' }}>
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
