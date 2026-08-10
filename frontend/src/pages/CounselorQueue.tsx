import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import {
  Headphones, Flame, Clock, CheckCircle, Phone, Calendar,
  Search, Filter, History, MessageSquare, AlertCircle, RefreshCw, X, ChevronRight, User, UserPlus, Trash2, Mail
} from 'lucide-react';

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
  assigned_counselor_id: string | null;
  created_at: string;
}

interface Counselor {
  id: string;
  name: string;
  email: string;
  phone_number: string | null;
}

interface CounselorQueueProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onViewContact?: (contactId: string) => void;
}

export default function CounselorQueue({ showToast, onViewContact }: CounselorQueueProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [counselors, setCounselors] = useState<Counselor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [queueFilter, setQueueFilter] = useState<'all' | 'hot' | 'warm' | 'callback'>('hot');
  const [activeWorkspace, setActiveWorkspace] = useState<'queue' | 'roster'>('queue');

  // Action Modals State
  const [selectedForNote, setSelectedForNote] = useState<Contact | null>(null);
  const [counselorNote, setCounselorNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [rescheduleContact, setRescheduleContact] = useState<Contact | null>(null);
  const [scheduledFor, setScheduledFor] = useState('');
  const [rescheduling, setRescheduling] = useState(false);

  // Counselor Onboarding State
  const [showAddCounselor, setShowAddCounselor] = useState(false);
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [savingCounselor, setSavingCounselor] = useState(false);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await api.get('/contacts', {
        params: {
          search,
          page: 1,
          page_size: 100,
        },
      });
      setContacts(res.data.items || []);
    } catch (err) {
      console.error('Error fetching counselor queue:', err);
      showToast(getErrorMessage(err, 'Failed to load counselor queue'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchCounselors = async () => {
    try {
      const res = await api.get('/contacts/counselors/all');
      setCounselors(res.data || []);
    } catch (err) {
      console.error('Failed to fetch counselors roster:', err);
    }
  };

  useEffect(() => {
    fetchQueue();
    fetchCounselors();
  }, [search, activeWorkspace]);

  const filteredContacts = contacts.filter(c => {
    if (queueFilter === 'hot') return c.interest_level === 'Hot Lead' || c.lead_score >= 60;
    if (queueFilter === 'warm') return c.interest_level === 'Warm Lead' || (c.lead_score >= 30 && c.lead_score < 60);
    if (queueFilter === 'callback') return c.status === 'NeedsReschedule' || c.status === 'Scheduled';
    return true;
  });

  const hotCount = contacts.filter(c => c.interest_level === 'Hot Lead' || c.lead_score >= 60).length;
  const warmCount = contacts.filter(c => c.interest_level === 'Warm Lead' || (c.lead_score >= 30 && c.lead_score < 60)).length;
  const callbackCount = contacts.filter(c => c.status === 'NeedsReschedule' || c.status === 'Scheduled').length;

  const triggerCall = async (contact: Contact) => {
    try {
      await api.post(`/calls/${contact.id}/call-now`);
      showToast(`Initiated direct counselor callback to ${contact.name}!`, 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to initiate callback'), 'error');
    }
  };

  const saveCounselorNote = async () => {
    if (!selectedForNote) return;
    setSavingNote(true);
    try {
      await api.patch(`/contacts/${selectedForNote.id}`, {
        notes: counselorNote,
      });
      showToast(`Counselor note saved for ${selectedForNote.name}`, 'success');
      setSelectedForNote(null);
      setCounselorNote('');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save counselor note'), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const handleAssignCounselor = async (contactId: string, counselorId: string) => {
    try {
      const val = counselorId === 'none' ? null : counselorId;
      await api.patch(`/contacts/${contactId}`, {
        assigned_counselor_id: val
      });
      showToast('Counselor assignment updated successfully', 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to update counselor assignment'), 'error');
    }
  };

  const handleOnboardCounselor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cName || !cEmail) {
      showToast('Name and Email are required', 'error');
      return;
    }
    setSavingCounselor(true);
    try {
      await api.post('/contacts/counselors', {
        name: cName,
        email: cEmail,
        phone_number: cPhone || null
      });
      showToast(`${cName} onboarded successfully!`, 'success');
      setCName('');
      setCEmail('');
      setCPhone('');
      setShowAddCounselor(false);
      fetchCounselors();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to onboard counselor'), 'error');
    } finally {
      setSavingCounselor(false);
    }
  };

  const handleRemoveCounselor = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove counselor ${name}?`)) return;
    try {
      await api.delete(`/contacts/counselors/${id}`);
      showToast(`${name} removed from roster`, 'success');
      fetchCounselors();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to remove counselor'), 'error');
    }
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
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to schedule callback'), 'error');
    } finally {
      setRescheduling(false);
    }
  };

  return (
    <div>
      {/* Header & Tabs */}
      <div style={{ marginBottom: '28px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Headphones style={{ color: 'var(--accent-primary)' }} size={32} />
            Counselor Priority Queue
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '0.95rem' }}>
            Prioritized lead callbacks scored by AI. Spend your time only on conversations that convert.
          </p>
        </div>

        {/* Workspace selector switcher */}
        <div style={{ display: 'flex', background: 'var(--bg-tertiary)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <button
            onClick={() => setActiveWorkspace('queue')}
            className={`btn ${activeWorkspace === 'queue' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.82rem', padding: '6px 16px', border: 'none' }}
          >
            🎯 Priority Queue
          </button>
          <button
            onClick={() => setActiveWorkspace('roster')}
            className={`btn ${activeWorkspace === 'roster' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.82rem', padding: '6px 16px', border: 'none' }}
          >
            👥 Counselors Roster
          </button>
        </div>
      </div>

      {activeWorkspace === 'queue' ? (
        <>
          {/* KPI Stats Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '16px', marginBottom: '28px' }}>
            <div
              onClick={() => setQueueFilter('hot')}
              className="glass-panel hover-lift"
              style={{
                padding: '20px', cursor: 'pointer',
                borderLeft: queueFilter === 'hot' ? '4px solid #ef4444' : undefined,
                background: queueFilter === 'hot' ? 'rgba(239, 68, 68, 0.05)' : undefined
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🔥 Hot Leads
                </span>
                <Flame size={20} style={{ color: '#ef4444' }} />
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: '8px', fontFamily: 'var(--font-display)' }}>{hotCount}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Ready for immediate call</div>
            </div>

            <div
              onClick={() => setQueueFilter('warm')}
              className="glass-panel hover-lift"
              style={{
                padding: '20px', cursor: 'pointer',
                borderLeft: queueFilter === 'warm' ? '4px solid #f59e0b' : undefined,
                background: queueFilter === 'warm' ? 'rgba(245, 158, 11, 0.05)' : undefined
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🟡 Warm Follow-ups
                </span>
                <Clock size={20} style={{ color: '#f59e0b' }} />
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: '8px', fontFamily: 'var(--font-display)' }}>{warmCount}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>High intent, nurture required</div>
            </div>

            <div
              onClick={() => setQueueFilter('callback')}
              className="glass-panel hover-lift"
              style={{
                padding: '20px', cursor: 'pointer',
                borderLeft: queueFilter === 'callback' ? '4px solid #7c3aed' : undefined,
                background: queueFilter === 'callback' ? 'rgba(124, 58, 237, 0.05)' : undefined
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  📞 Requested Callbacks
                </span>
                <Calendar size={20} style={{ color: '#7c3aed' }} />
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: '8px', fontFamily: 'var(--font-display)' }}>{callbackCount}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Parent requested call</div>
            </div>

            <div
              onClick={() => setQueueFilter('all')}
              className="glass-panel hover-lift"
              style={{
                padding: '20px', cursor: 'pointer',
                borderLeft: queueFilter === 'all' ? '4px solid #06b6d4' : undefined,
                background: queueFilter === 'all' ? 'rgba(6, 182, 212, 0.05)' : undefined
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  📋 Total Queue
                </span>
                <Filter size={20} style={{ color: '#06b6d4' }} />
              </div>
              <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: '8px', fontFamily: 'var(--font-display)' }}>{contacts.length}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>All scored leads</div>
            </div>
          </div>

          {/* Filter and Search controls */}
          <div className="glass-panel" style={{ padding: '16px', marginBottom: '24px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg-tertiary)', padding: '10px 16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
              <Search size={18} style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search lead by name, phone, or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none', width: '100%', fontSize: '0.92rem' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              {(['hot', 'warm', 'callback', 'all'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setQueueFilter(tab)}
                  className={`btn ${queueFilter === tab ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontSize: '0.82rem', padding: '8px 14px' }}
                >
                  {tab === 'hot' && '🔥 Hot Leads'}
                  {tab === 'warm' && '🟡 Warm'}
                  {tab === 'callback' && '📞 Callbacks'}
                  {tab === 'all' && 'All'}
                </button>
              ))}
            </div>
          </div>

          {/* Lead Queue Cards */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px' }}>
              <RefreshCw className="animate-spin" style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-primary)' }} size={36} />
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="glass-panel" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <CheckCircle size={40} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
              <h3>No leads in this queue</h3>
              <p style={{ marginTop: '4px', fontSize: '0.9rem' }}>Try switching filters or searching for another lead name.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredContacts.map(c => {
                const isHot = c.interest_level === 'Hot Lead' || c.lead_score >= 60;
                const isWarm = c.interest_level === 'Warm Lead' || (c.lead_score >= 30 && c.lead_score < 60);

                return (
                  <div key={c.id} className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Top Row: Lead info & Score */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <div style={{
                          width: '44px', height: '44px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 800, fontSize: '1rem', flexShrink: 0
                        }}>
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700 }}>{c.name}</h3>
                            <span style={{
                              padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700,
                              background: isHot ? 'rgba(239, 68, 68, 0.12)' : isWarm ? 'rgba(245, 158, 11, 0.12)' : 'rgba(124, 58, 237, 0.12)',
                              color: isHot ? '#ef4444' : isWarm ? '#f59e0b' : '#7c3aed',
                              border: `1px solid ${isHot ? 'rgba(239, 68, 68, 0.2)' : isWarm ? 'rgba(245, 158, 11, 0.2)' : 'rgba(124, 58, 237, 0.2)'}`
                            }}>
                              {isHot ? '🔥 Hot Lead' : isWarm ? '🟡 Warm Lead' : c.interest_level}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            <span>📞 {c.phone_number}</span>
                            {c.email && <span>✉️ {c.email}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Counselor Assignment & Score */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                        {/* Assign Counselor dropdown */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Assigned Counselor
                          </span>
                          <select
                            value={c.assigned_counselor_id || 'none'}
                            onChange={(e) => handleAssignCounselor(c.id, e.target.value)}
                            style={{
                              background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                              padding: '6px 12px', borderRadius: '8px', color: 'var(--text-primary)',
                              fontSize: '0.82rem', outline: 'none', cursor: 'pointer'
                            }}
                          >
                            <option value="none">Unassigned</option>
                            {counselors.map(cns => (
                              <option key={cns.id} value={cns.id}>{cns.name}</option>
                            ))}
                          </select>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent-primary)', lineHeight: 1, fontFamily: 'var(--font-display)' }}>
                            {c.lead_score}
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}> /100</span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Lead Score
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Score Reasons & AI 20-Point Profile */}
                    {c.score_reasons && c.score_reasons.length > 0 && (
                      <div style={{ background: 'var(--bg-tertiary)', padding: '14px 16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                          Key Qualification Indicators
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {c.score_reasons.map((reason, idx) => (
                            <span key={idx} style={{
                              padding: '3px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                              background: 'rgba(124, 58, 237, 0.08)', color: 'var(--accent-primary)',
                              border: '1px solid rgba(124, 58, 237, 0.15)'
                            }}>
                              • {reason}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Counselor Notes if present */}
                    {c.notes && (
                      <div style={{ background: 'rgba(245, 158, 11, 0.08)', padding: '12px 16px', borderRadius: '10px', borderLeft: '3px solid #f59e0b', fontSize: '0.85rem' }}>
                        <strong style={{ color: '#f59e0b' }}>Counselor Note:</strong> {c.notes}
                      </div>
                    )}

                    {/* Bottom Action Toolbar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: '0.82rem', padding: '8px 14px' }}
                          onClick={() => triggerCall(c)}
                        >
                          <Phone size={14} />
                          Call Lead Now
                        </button>

                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.82rem', padding: '8px 14px' }}
                          onClick={() => {
                            setSelectedForNote(c);
                            setCounselorNote(c.notes || '');
                          }}
                        >
                          <MessageSquare size={14} />
                          Add Counselor Note
                        </button>

                        <button
                          className="btn btn-secondary"
                          style={{ fontSize: '0.82rem', padding: '8px 14px' }}
                          onClick={() => {
                            setRescheduleContact(c);
                            const tmrw = new Date();
                            tmrw.setDate(tmrw.getDate() + 1);
                            setScheduledFor(tmrw.toISOString().slice(0, 16));
                          }}
                        >
                          <Calendar size={14} />
                          Schedule Callback
                        </button>
                      </div>

                      {onViewContact && (
                        <button
                          onClick={() => onViewContact(c.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          View Call History & Transcript <ChevronRight size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* Counselors Roster Workspace (Counselor Onboarding Roster) */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700 }}>Active Counselors List</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>Onboard and manage the admissions team roster for your school.</p>
            </div>
            <button
              onClick={() => setShowAddCounselor(true)}
              className="btn btn-primary"
              style={{ fontSize: '0.85rem', padding: '10px 18px' }}
            >
              <UserPlus size={16} />
              Onboard Counselor
            </button>
          </div>

          {counselors.length === 0 ? (
            <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <User size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <h3>No counselors onboarded yet</h3>
              <p style={{ marginTop: '4px', fontSize: '0.9rem' }}>Add counselors so leads can be assigned to them directly.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '16px' }}>
              {counselors.map(cns => {
                // Calculate assigned leads count
                const assignedCount = contacts.filter(con => con.assigned_counselor_id === cns.id).length;

                return (
                  <div key={cns.id} className="glass-panel hover-lift" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: '40px', height: '40px', borderRadius: '50%',
                          background: 'rgba(124, 58, 237, 0.12)', color: 'var(--accent-primary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700
                        }}>
                          {cns.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1rem', fontWeight: 700 }}>{cns.name}</h4>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Admissions Counselor</span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemoveCounselor(cns.id, cns.name)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '6px', borderRadius: '8px' }}
                        title="Remove Counselor"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.85rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Mail size={14} style={{ color: 'var(--text-muted)' }} />
                        <span>{cns.email}</span>
                      </div>
                      {cns.phone_number && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Phone size={14} style={{ color: 'var(--text-muted)' }} />
                          <span>{cns.phone_number}</span>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Assigned Leads</span>
                      <span style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--accent-primary)' }}>{assignedCount}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Onboard Counselor Modal */}
      {showAddCounselor && (
        <div className="modal-overlay">
          <form onSubmit={handleOnboardCounselor} className="glass-panel modal-content" style={{ padding: '28px', maxWidth: '480px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700 }}>
                Onboard New Counselor
              </h3>
              <button type="button" onClick={() => setShowAddCounselor(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  className="form-input"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. rahul.sharma@school.edu"
                  className="form-input"
                  value={cEmail}
                  onChange={(e) => setCEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Phone Number (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. +91 98765 43210"
                  className="form-input"
                  value={cPhone}
                  onChange={(e) => setCPhone(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setShowAddCounselor(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={savingCounselor}>
                {savingCounselor ? 'Onboarding...' : 'Onboard Counselor'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Note Modal */}
      {selectedForNote && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ padding: '28px', maxWidth: '500px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700 }}>
                Counselor Note: {selectedForNote.name}
              </h3>
              <button onClick={() => setSelectedForNote(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">Notes & Observations</label>
              <textarea
                className="form-input"
                rows={4}
                value={counselorNote}
                onChange={(e) => setCounselorNote(e.target.value)}
                placeholder="Enter admissions notes, parent preferences, fee discussion details..."
                style={{ resize: 'vertical' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setSelectedForNote(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCounselorNote} disabled={savingNote}>
                {savingNote ? 'Saving...' : 'Save Note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleContact && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ padding: '28px', maxWidth: '500px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700 }}>
                Schedule Callback: {rescheduleContact.name}
              </h3>
              <button onClick={() => setRescheduleContact(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label">Callback Date & Time</label>
              <input
                type="datetime-local"
                className="form-input"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setRescheduleContact(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitReschedule} disabled={rescheduling}>
                {rescheduling ? 'Scheduling...' : 'Confirm Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
