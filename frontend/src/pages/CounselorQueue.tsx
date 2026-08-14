import React, { useEffect, useState, useCallback } from 'react';
import api, { getErrorMessage } from '../api';
import { useSSE } from '../hooks/useSSE';
import { LeadJourneyStepper, LeadStepBadge, calculateLeadJourney } from '../components/LeadJourneyStepper';
import { exportToExcel } from '../utils/exportToExcel';
import {
  Headphones, Flame, Clock, CheckCircle, Phone, Calendar,
  Search, Filter, History, MessageSquare, AlertCircle, RefreshCw, X, ChevronRight, User, UserPlus, Trash2, Mail,
  RotateCcw, CheckCircle2, Check, BarChart2, Award, Zap, Layers, Send, ArrowRight, ShieldAlert, CheckSquare, Square, FileSpreadsheet
} from 'lucide-react';

interface Contact {
  id: string;
  name: string;
  phone_number: string;
  email: string | null;
  notes: string | null;
  status: 'Pending' | 'Calling' | 'Completed' | 'NeedsReschedule' | 'Scheduled' | 'Failed';
  interest_level: 'HOT' | 'WARM' | 'COLD' | 'UNSCORED' | string;
  lead_score: number;
  score_reasons?: string[];
  assigned_counselor_id: string | null;
  counselor_followup_status?: 'Pending' | 'InProgress' | 'Completed';
  next_scheduled_callback?: {
    id: string;
    scheduled_for: string;
    call_type: string;
    reason?: string;
  } | null;
  created_at: string;
}

interface Counselor {
  id: string;
  name: string;
  email: string;
  phone_number: string | null;
  availability_status: 'Available' | 'InConsultation' | 'OnLeave';
  max_capacity: number;
  active_lead_count: number;
}

interface CounselorActivity {
  id: string;
  contact_id: string;
  counselor_id: string | null;
  counselor_name?: string;
  action_type: string;
  outcome: string | null;
  notes: string | null;
  created_at: string;
}

interface CounselorAnalytics {
  counselor_id: string;
  name: string;
  email: string;
  availability_status: 'Available' | 'InConsultation' | 'OnLeave';
  total_assigned: number;
  completed_count: number;
  conversion_rate: number;
  hot_leads_assigned: number;
  active_leads: number;
  activity_count_7d: number;
  avg_response_hours: number | null;
}

interface CounselorQueueProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onViewContact?: (contactId: string) => void;
  initialWorkspace?: 'queue' | 'completed' | 'roster' | 'analytics';
}

export default function CounselorQueue({ showToast, onViewContact, initialWorkspace = 'queue' }: CounselorQueueProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [counselors, setCounselors] = useState<Counselor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [queueFilter, setQueueFilter] = useState<'all' | 'hot' | 'warm' | 'callback'>('hot');
  const [counselorFilter, setCounselorFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'scheduled_time' | 'lead_score' | 'newest'>('scheduled_time');
  const [hasDefaultedFilter, setHasDefaultedFilter] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<'queue' | 'completed' | 'roster' | 'analytics'>(initialWorkspace);

  // Bulk Operations State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'assign' | 'status' | 'schedule' | null>(null);
  const [bulkCounselorId, setBulkCounselorId] = useState('');
  const [bulkStatus, setBulkStatus] = useState('Completed');
  const [bulkScheduleTime, setBulkScheduleTime] = useState('');
  const [bulkExecuting, setBulkExecuting] = useState(false);

  // Activity History State
  const [activeHistoryContact, setActiveHistoryContact] = useState<Contact | null>(null);
  const [activityHistory, setActivityHistory] = useState<CounselorActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [newActionType, setNewActionType] = useState('Call');
  const [newActionOutcome, setNewActionOutcome] = useState('Follow-up Call Connected');
  const [newActionNotes, setNewActionNotes] = useState('');
  const [loggingActivity, setLoggingActivity] = useState(false);

  // Action Modals State
  const [selectedForNote, setSelectedForNote] = useState<Contact | null>(null);
  const [counselorNote, setCounselorNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [completeContact, setCompleteContact] = useState<Contact | null>(null);
  const [completeOutcome, setCompleteOutcome] = useState('Campus Visit Scheduled');
  const [completeNote, setCompleteNote] = useState('');
  const [completing, setCompleting] = useState(false);

  const [rescheduleContact, setRescheduleContact] = useState<Contact | null>(null);
  const [scheduledFor, setScheduledFor] = useState('');
  const [rescheduling, setRescheduling] = useState(false);

  // Counselor Onboarding State
  const [showAddCounselor, setShowAddCounselor] = useState(false);
  const [cName, setCName] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [savingCounselor, setSavingCounselor] = useState(false);
  const [counselorCredentials, setCounselorCredentials] = useState<{ email: string; password?: string | null; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Analytics State
  const [analytics, setAnalytics] = useState<CounselorAnalytics[]>([]);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  const [autoAssigning, setAutoAssigning] = useState(false);

  const handleAutoAssign = async () => {
    setAutoAssigning(true);
    try {
      const res = await api.post('/contacts/counselors/auto-assign');
      showToast(res.data.message || 'Auto-assignment complete!', 'success');
      fetchQueue();
      fetchCounselors();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to auto-assign leads'), 'error');
    } finally {
      setAutoAssigning(false);
    }
  };

  const fetchQueue = useCallback(async () => {
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
  }, [search, showToast]);

  const fetchCounselors = async () => {
    try {
      const res = await api.get('/contacts/counselors/all');
      const loaded: Counselor[] = res.data || [];
      setCounselors(loaded);

      if (!hasDefaultedFilter && loggedInUserEmail) {
        const mine = loaded.find(c => c.email.toLowerCase() === loggedInUserEmail.toLowerCase());
        if (mine) {
          setCounselorFilter(mine.id);
        }
        setHasDefaultedFilter(true);
      }
    } catch (err) {
      console.error('Failed to fetch counselors roster:', err);
    }
  };

  const fetchAnalytics = async () => {
    setLoadingAnalytics(true);
    try {
      const res = await api.get('/contacts/counselors/analytics');
      setAnalytics(res.data || []);
    } catch (err) {
      console.error('Failed to fetch counselor analytics:', err);
    } finally {
      setLoadingAnalytics(false);
    }
  };

  // Real-time Push via SSE (Instant updates for counselor queue)
  useSSE(useCallback((msg) => {
    fetchQueue();
    fetchCounselors();
    if (activeWorkspace === 'analytics') {
      fetchAnalytics();
    }
  }, [fetchQueue, activeWorkspace]), [
    'CALL_STARTED',
    'CALL_ENDED',
    'CALL_ANALYZED',
    'APPOINTMENT_BOOKED',
    'CALLBACK_SCHEDULED',
    'CONTACT_UPDATED',
    'COUNSELOR_ASSIGNED',
    'CAMPAIGN_UPDATE'
  ]);

  const loggedInUserEmail = (() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null');
      return u?.email || null;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (initialWorkspace) {
      setActiveWorkspace(initialWorkspace);
    }
  }, [initialWorkspace]);

  useEffect(() => {
    fetchQueue();
    fetchCounselors();
    if (activeWorkspace === 'analytics') {
      fetchAnalytics();
    }
  }, [fetchQueue, activeWorkspace]);

  // Activity History Drawer Logic
  const openActivityHistory = async (contact: Contact) => {
    setActiveHistoryContact(contact);
    setLoadingActivities(true);
    try {
      const res = await api.get(`/contacts/${contact.id}/activities`);
      setActivityHistory(res.data.items || []);
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to fetch follow-up history'), 'error');
    } finally {
      setLoadingActivities(false);
    }
  };

  const submitNewActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeHistoryContact) return;
    setLoggingActivity(true);
    try {
      await api.post(`/contacts/${activeHistoryContact.id}/activities`, {
        action_type: newActionType,
        outcome: newActionOutcome,
        notes: newActionNotes || null,
      });
      showToast('Follow-up activity logged successfully!', 'success');
      setNewActionNotes('');
      // Refresh list
      const res = await api.get(`/contacts/${activeHistoryContact.id}/activities`);
      setActivityHistory(res.data.items || []);
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to log activity'), 'error');
    } finally {
      setLoggingActivity(false);
    }
  };

  // Counselor Availability status update
  const handleUpdateAvailability = async (counselorId: string, status: 'Available' | 'InConsultation' | 'OnLeave') => {
    try {
      await api.patch(`/contacts/counselors/${counselorId}`, {
        availability_status: status
      });
      showToast(`Status updated to ${status}`, 'success');
      fetchCounselors();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to update counselor status'), 'error');
    }
  };

  const isCompleted = (c: Contact) => c.counselor_followup_status === 'Completed';
  const activeContacts = contacts.filter(c => !isCompleted(c));
  const completedContacts = contacts.filter(c => isCompleted(c));

  const currentDataset = activeWorkspace === 'completed' ? completedContacts : activeContacts;

  const formatDateTime = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return isoStr;
    }
  };

  const filteredContacts = currentDataset.filter(c => {
    // 1. Queue priority filter (only applied on active queue)
    if (activeWorkspace === 'queue') {
      if (queueFilter === 'hot') {
        if (!(c.interest_level === 'HOT' || c.lead_score >= 75)) return false;
      } else if (queueFilter === 'warm') {
        if (!(c.interest_level === 'WARM' || (c.lead_score >= 50 && c.lead_score < 75))) return false;
      } else if (queueFilter === 'callback') {
        if (!(c.status === 'NeedsReschedule' || c.status === 'Scheduled' || !!c.next_scheduled_callback)) return false;
      }
    }

    // 2. Counselor filter
    if (counselorFilter === 'unassigned') {
      return !c.assigned_counselor_id;
    } else if (counselorFilter !== 'all') {
      return c.assigned_counselor_id === counselorFilter;
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === 'scheduled_time') {
      const aCb = a.next_scheduled_callback?.scheduled_for;
      const bCb = b.next_scheduled_callback?.scheduled_for;
      if (aCb && bCb) return new Date(aCb).getTime() - new Date(bCb).getTime();
      if (aCb) return -1;
      if (bCb) return 1;
      return (b.lead_score || 0) - (a.lead_score || 0);
    } else if (sortBy === 'lead_score') {
      return (b.lead_score || 0) - (a.lead_score || 0);
    } else {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
  });

  const hotCount = activeContacts.filter(c => {
    const belongs = counselorFilter === 'unassigned' ? !c.assigned_counselor_id : (counselorFilter === 'all' || c.assigned_counselor_id === counselorFilter);
    return belongs && (c.interest_level === 'HOT' || c.lead_score >= 75);
  }).length;

  const warmCount = activeContacts.filter(c => {
    const belongs = counselorFilter === 'unassigned' ? !c.assigned_counselor_id : (counselorFilter === 'all' || c.assigned_counselor_id === counselorFilter);
    return belongs && (c.interest_level === 'WARM' || (c.lead_score >= 50 && c.lead_score < 75));
  }).length;

  const callbackCount = activeContacts.filter(c => {
    const belongs = counselorFilter === 'unassigned' ? !c.assigned_counselor_id : (counselorFilter === 'all' || c.assigned_counselor_id === counselorFilter);
    return belongs && (c.status === 'NeedsReschedule' || c.status === 'Scheduled');
  }).length;

  const totalActiveCount = activeContacts.filter(c => {
    return counselorFilter === 'unassigned' ? !c.assigned_counselor_id : (counselorFilter === 'all' || c.assigned_counselor_id === counselorFilter);
  }).length;

  const totalCompletedCount = completedContacts.filter(c => {
    return counselorFilter === 'unassigned' ? !c.assigned_counselor_id : (counselorFilter === 'all' || c.assigned_counselor_id === counselorFilter);
  }).length;

  // Bulk Selection Helpers
  const toggleSelectContact = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    if (selectedIds.size === filteredContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredContacts.map(c => c.id)));
    }
  };

  const handleExecuteBulk = async () => {
    if (selectedIds.size === 0) return;
    setBulkExecuting(true);
    try {
      const contact_ids = Array.from(selectedIds);
      if (bulkAction === 'assign') {
        if (!bulkCounselorId) {
          showToast('Please select a counselor to assign', 'error');
          return;
        }
        await api.post('/contacts/bulk-update', {
          contact_ids,
          action: 'assign',
          assigned_counselor_id: bulkCounselorId === 'unassign' ? null : bulkCounselorId
        });
        showToast(`Assigned ${contact_ids.length} leads successfully!`, 'success');
      } else if (bulkAction === 'status') {
        await api.post('/contacts/bulk-update', {
          contact_ids,
          action: 'status_change',
          status: bulkStatus
        });
        showToast(`Updated status for ${contact_ids.length} leads!`, 'success');
      } else if (bulkAction === 'schedule') {
        if (!bulkScheduleTime) {
          showToast('Please specify callback date & time', 'error');
          return;
        }
        await api.post('/contacts/bulk-update', {
          contact_ids,
          action: 'schedule',
          scheduled_for: new Date(bulkScheduleTime).toISOString()
        });
        showToast(`Scheduled callbacks for ${contact_ids.length} leads!`, 'success');
      }
      setSelectedIds(new Set());
      setBulkAction(null);
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Bulk operation failed'), 'error');
    } finally {
      setBulkExecuting(false);
    }
  };

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
      // Also log structured activity
      await api.post(`/contacts/${selectedForNote.id}/activities`, {
        action_type: 'Note',
        outcome: 'Counselor Note Saved',
        notes: counselorNote
      });
      showToast('Counselor note saved!', 'success');
      setSelectedForNote(null);
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save note'), 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const handleCompleteFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completeContact) return;
    setCompleting(true);
    try {
      await api.patch(`/contacts/${completeContact.id}`, {
        counselor_followup_status: 'Completed',
        notes: completeNote ? `[Outcome: ${completeOutcome}] ${completeNote}` : `[Outcome: ${completeOutcome}]`
      });
      await api.post(`/contacts/${completeContact.id}/activities`, {
        action_type: 'Call',
        outcome: completeOutcome,
        notes: completeNote || 'Follow-up marked completed'
      });
      showToast(`Follow-up completed for ${completeContact.name}!`, 'success');
      setCompleteContact(null);
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to complete follow-up'), 'error');
    } finally {
      setCompleting(false);
    }
  };

  const handleReopenFollowUp = async (contact: Contact) => {
    try {
      await api.patch(`/contacts/${contact.id}`, {
        counselor_followup_status: 'Pending'
      });
      await api.post(`/contacts/${contact.id}/activities`, {
        action_type: 'StatusChange',
        outcome: 'Reopened Follow-up',
        notes: 'Contact moved back to active counselor queue'
      });
      showToast(`Reopened follow-up for ${contact.name}!`, 'success');
      fetchQueue();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to reopen follow-up'), 'error');
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
      fetchCounselors();
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
      const res = await api.post('/contacts/counselors', {
        name: cName,
        email: cEmail,
        phone_number: cPhone || null
      });
      showToast(`${cName} onboarded successfully!`, 'success');
      
      const tempPassword = res.data.temp_password;
      if (tempPassword) {
        setCounselorCredentials({
          email: cEmail,
          password: tempPassword,
          name: cName
        });
      }

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

  const handleUpdateCapacity = async (counselorId: string, capacity: number) => {
    try {
      await api.patch(`/contacts/counselors/${counselorId}`, {
        max_capacity: capacity,
      });
      showToast(`Workload capacity updated to ${capacity}`, 'success');
      fetchCounselors();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to update capacity'), 'error');
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
      await api.post(`/contacts/${rescheduleContact.id}/activities`, {
        action_type: 'Call',
        outcome: 'Callback Scheduled',
        notes: `Follow-up scheduled for ${scheduledFor}`
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
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Counselor Priority Queue
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px', fontSize: '0.95rem' }}>
            Prioritized lead callbacks scored by AI. Spend your time only on conversations that convert.
          </p>
        </div>

        {/* Workspace selector switcher */}
        <div style={{ display: 'flex', background: 'var(--bg-tertiary)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)', gap: '4px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveWorkspace('queue')}
            className={`btn ${activeWorkspace === 'queue' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.82rem', padding: '6px 14px', border: 'none' }}
          >
            Active Queue ({totalActiveCount})
          </button>
          <button
            onClick={() => setActiveWorkspace('completed')}
            className={`btn ${activeWorkspace === 'completed' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.82rem', padding: '6px 14px', border: 'none' }}
          >
            Completed ({totalCompletedCount})
          </button>
          <button
            onClick={() => setActiveWorkspace('roster')}
            className={`btn ${activeWorkspace === 'roster' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.82rem', padding: '6px 14px', border: 'none' }}
          >
            Counselors Roster ({counselors.length})
          </button>
          <button
            onClick={() => { setActiveWorkspace('analytics'); fetchAnalytics(); }}
            className={`btn ${activeWorkspace === 'analytics' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.82rem', padding: '6px 14px', border: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <BarChart2 size={14} />
            Performance
          </button>
        </div>
      </div>

      {activeWorkspace === 'queue' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div
            onClick={() => setQueueFilter('hot')}
            className="glass-panel hover-lift"
            style={{
              padding: '20px', cursor: 'pointer',
              borderLeft: queueFilter === 'hot' ? '4px solid #ef4444' : undefined,
              background: queueFilter === 'hot' ? 'rgba(239, 68, 68, 0.05)' : undefined
            }}
          >
            <div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Hot Leads
              </span>
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
            <div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Warm Follow-ups
              </span>
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: '8px', fontFamily: 'var(--font-display)' }}>{warmCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>High potential leads</div>
          </div>

          <div
            onClick={() => setQueueFilter('callback')}
            className="glass-panel hover-lift"
            style={{
              padding: '20px', cursor: 'pointer',
              borderLeft: queueFilter === 'callback' ? '4px solid #3b82f6' : undefined,
              background: queueFilter === 'callback' ? 'rgba(59, 130, 246, 0.05)' : undefined
            }}
          >
            <div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Callbacks & Retries
              </span>
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: '8px', fontFamily: 'var(--font-display)' }}>{callbackCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Scheduled follow-ups</div>
          </div>

          <div
            onClick={() => setQueueFilter('all')}
            className="glass-panel hover-lift"
            style={{
              padding: '20px', cursor: 'pointer',
              borderLeft: queueFilter === 'all' ? '4px solid var(--accent-primary)' : undefined,
              background: queueFilter === 'all' ? 'rgba(124, 58, 237, 0.05)' : undefined
            }}
          >
            <div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                All Queue Leads
              </span>
            </div>
            <div style={{ fontSize: '1.8rem', fontWeight: 800, marginTop: '8px', fontFamily: 'var(--font-display)' }}>{totalActiveCount}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>Total pending engagement</div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {activeWorkspace === 'queue' || activeWorkspace === 'completed' ? (
        <>
          {/* Controls Bar: Search, Counselor Filter & Auto-Assign */}
          <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flex: '1 1 300px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 200px' }}>
                <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Search leads by name, phone or email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="form-input"
                  style={{ paddingLeft: '36px', fontSize: '0.88rem' }}
                />
              </div>

              {/* Counselor Filter Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Filter size={15} style={{ color: 'var(--text-muted)' }} />
                <select
                  value={counselorFilter}
                  onChange={(e) => setCounselorFilter(e.target.value)}
                  className="form-input"
                  style={{ fontSize: '0.85rem', padding: '8px 12px', minWidth: '170px', fontWeight: 600 }}
                >
                  {(() => {
                    const mine = counselors.find(c => c.email.toLowerCase() === (loggedInUserEmail || '').toLowerCase());
                    return (
                      <>
                        {mine && <option value={mine.id}>My Queue ({mine.name})</option>}
                        <option value="all">All Counselors (Entire Team)</option>
                        <option value="unassigned">Unassigned Only</option>
                        {counselors
                          .filter(cns => !mine || cns.id !== mine.id)
                          .map(cns => (
                            <option key={cns.id} value={cns.id}>{cns.name}</option>
                          ))
                        }
                      </>
                    );
                  })()}
                </select>
              </div>

              {/* Sort Order Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Clock size={15} style={{ color: 'var(--text-muted)' }} />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="form-input"
                  style={{ fontSize: '0.85rem', padding: '8px 12px', minWidth: '220px', fontWeight: 600 }}
                  title="Choose sorting order for leads"
                >
                  <option value="scheduled_time">⏰ Sort by Scheduled Time (Earliest First)</option>
                  <option value="lead_score">🔥 Sort by Lead Score (Highest First)</option>
                  <option value="newest">📅 Sort by Date Added (Newest First)</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  const filename = activeWorkspace === 'completed' ? 'Completed_Leads_Report' : 'Active_Counselor_Queue_Report';
                  exportToExcel(
                    filteredContacts,
                    [
                      { header: 'Lead Name', key: 'name' },
                      { header: 'Phone Number', key: 'phone_number' },
                      { header: 'Email', key: 'email' },
                      { header: 'Admissions Pipeline Stage', key: (c: any) => calculateLeadJourney(c).stepName },
                      { header: 'Priority Classification', key: (c: any) => c.interest_level || 'UNSCORED' },
                      { header: 'Lead Score', key: (c: any) => c.lead_score || 0 },
                      { header: 'Assigned Counselor', key: (c: any) => counselors.find(cns => cns.id === c.assigned_counselor_id)?.name || 'Unassigned' },
                      { header: 'Follow-up Status', key: (c: any) => c.counselor_followup_status || 'Pending' },
                      { header: 'AI Call Status', key: 'status' },
                      { header: 'Notes', key: (c: any) => c.notes || '' },
                      { header: 'Date Added', key: (c: any) => c.created_at || '' }
                    ],
                    filename
                  );
                }}
                style={{
                  fontSize: '0.82rem', padding: '8px 14px',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#10b981',
                  background: 'rgba(16, 185, 129, 0.08)'
                }}
                title="Export currently displayed leads to Excel CSV file"
              >
                <FileSpreadsheet size={15} />
                Export Excel
              </button>

              {activeWorkspace === 'queue' && (
                <button
                  onClick={handleAutoAssign}
                  className="btn btn-secondary"
                  disabled={autoAssigning}
                  style={{
                    fontSize: '0.82rem', padding: '8px 14px',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    border: '1px solid rgba(124, 58, 237, 0.3)',
                    color: 'var(--accent-primary)',
                    background: 'rgba(124, 58, 237, 0.08)'
                  }}
                  title="Evenly distribute unassigned hot leads to available counselors"
                >
                  <RefreshCw size={14} className={autoAssigning ? 'spin' : ''} />
                  {autoAssigning ? 'Auto-Assigning...' : 'Auto-Assign Unassigned'}
                </button>
              )}

              <button
                onClick={fetchQueue}
                className="btn btn-secondary"
                style={{ fontSize: '0.82rem', padding: '8px 12px' }}
                title="Refresh queue"
              >
                <RefreshCw size={14} className={loading ? 'spin' : ''} />
              </button>
            </div>
          </div>

          {/* Bulk Action Toolbar */}
          {activeWorkspace === 'queue' && filteredContacts.length > 0 && (
            <div className="glass-panel" style={{
              padding: '12px 18px', marginBottom: '16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px',
              background: selectedIds.size > 0 ? 'rgba(124, 58, 237, 0.08)' : undefined,
              border: selectedIds.size > 0 ? '1px solid rgba(124, 58, 237, 0.3)' : undefined
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  onClick={selectAllFiltered}
                  style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 600 }}
                >
                  {selectedIds.size === filteredContacts.length && filteredContacts.length > 0 ? (
                    <CheckSquare size={16} style={{ color: 'var(--accent-primary)' }} />
                  ) : (
                    <Square size={16} style={{ color: 'var(--text-muted)' }} />
                  )}
                  <span>Select All ({selectedIds.size} of {filteredContacts.length} selected)</span>
                </button>

                {selectedIds.size > 0 && (
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Clear selection
                  </button>
                )}
              </div>

              {selectedIds.size > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {bulkAction === null ? (
                    <>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                        onClick={() => setBulkAction('assign')}
                      >
                        Assign Counselor...
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                        onClick={() => setBulkAction('status')}
                      >
                        Change Status...
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                        onClick={() => setBulkAction('schedule')}
                      >
                        Schedule Callback...
                      </button>
                    </>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {bulkAction === 'assign' && (
                        <select
                          className="form-input"
                          style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                          value={bulkCounselorId}
                          onChange={(e) => setBulkCounselorId(e.target.value)}
                        >
                          <option value="">Select Counselor</option>
                          <option value="unassign">Unassign</option>
                          {counselors.map(cns => (
                            <option key={cns.id} value={cns.id}>{cns.name}</option>
                          ))}
                        </select>
                      )}

                      {bulkAction === 'status' && (
                        <select
                          className="form-input"
                          style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                          value={bulkStatus}
                          onChange={(e) => setBulkStatus(e.target.value)}
                        >
                          <option value="Completed">Completed</option>
                          <option value="NeedsReschedule">Needs Reschedule</option>
                          <option value="Pending">Pending</option>
                          <option value="Failed">Failed</option>
                        </select>
                      )}

                      {bulkAction === 'schedule' && (
                        <input
                          type="datetime-local"
                          className="form-input"
                          style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                          value={bulkScheduleTime}
                          onChange={(e) => setBulkScheduleTime(e.target.value)}
                        />
                      )}

                      <button
                        className="btn btn-primary"
                        style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                        onClick={handleExecuteBulk}
                        disabled={bulkExecuting}
                      >
                        {bulkExecuting ? 'Applying...' : 'Apply to Selected'}
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                        onClick={() => setBulkAction(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* List of Leads */}
          {loading ? (
            <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
              <div>Loading prioritized leads...</div>
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="glass-panel" style={{ padding: '60px 30px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {activeWorkspace === 'completed' ? (
                <>
                  <CheckCircle2 size={44} style={{ margin: '0 auto 12px', color: '#10b981', opacity: 0.8 }} />
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--text-primary)' }}>No Completed Follow-ups Yet</h3>
                  <p style={{ marginTop: '6px', fontSize: '0.88rem', color: 'var(--text-secondary)', maxWidth: '480px', margin: '6px auto 18px auto', lineHeight: 1.5 }}>
                    When counselors finish following up on a lead or schedule a campus visit, clicking <strong>"Mark Completed"</strong> moves the lead here to the completed archive.
                  </p>
                  <button
                    onClick={() => setActiveWorkspace('queue')}
                    className="btn btn-primary"
                    style={{ fontSize: '0.85rem', padding: '8px 18px', margin: '0 auto' }}
                  >
                    View Active Queue ({totalActiveCount} Leads)
                  </button>
                </>
              ) : (
                <>
                  <Headphones size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', color: 'var(--text-primary)' }}>No leads found in this view</h3>
                  <p style={{ marginTop: '4px', fontSize: '0.9rem' }}>Try clearing your search query or switching the priority filter.</p>
                </>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredContacts.map(c => {
                const isHot = c.interest_level === 'HOT' || c.lead_score >= 75;
                const isWarm = c.interest_level === 'WARM' || (c.lead_score >= 50 && c.lead_score < 75);
                const isSelected = selectedIds.has(c.id);

                return (
                  <div
                    key={c.id}
                    className="glass-panel hover-lift"
                    style={{
                      padding: '22px 24px',
                      display: 'flex', flexDirection: 'column', gap: '16px',
                      borderLeft: isHot ? '4px solid #ef4444' : isWarm ? '4px solid #f59e0b' : '4px solid var(--border-color)',
                      background: isSelected ? 'rgba(16, 185, 129, 0.04)' : undefined
                    }}
                  >
                    {/* Scheduled Callback Banner */}
                    {c.next_scheduled_callback && (
                      <div style={{
                        background: c.next_scheduled_callback.call_type === 'Counselor' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(99, 102, 241, 0.12)',
                        border: `1px solid ${c.next_scheduled_callback.call_type === 'Counselor' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(99, 102, 241, 0.3)'}`,
                        borderRadius: '10px',
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        width: '100%'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <Calendar size={16} style={{ color: c.next_scheduled_callback.call_type === 'Counselor' ? '#d97706' : '#6366f1' }} />
                          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: c.next_scheduled_callback.call_type === 'Counselor' ? '#d97706' : '#6366f1', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {c.next_scheduled_callback.call_type === 'Counselor' ? '👤 Counselor Callback Scheduled:' : '🤖 AI Agent Callback Scheduled:'}
                          </span>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            {formatDateTime(c.next_scheduled_callback.scheduled_for)}
                          </span>
                        </div>
                        {c.next_scheduled_callback.reason && (
                          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            Reason: {c.next_scheduled_callback.reason}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Top Row: Checkbox, Lead info & Score */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        {activeWorkspace === 'queue' && (
                          <div
                            onClick={() => toggleSelectContact(c.id)}
                            style={{ cursor: 'pointer', color: isSelected ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                          >
                            {isSelected ? <CheckSquare size={18} /> : <Square size={18} />}
                          </div>
                        )}

                        <div style={{
                          width: '42px', height: '42px', borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 800, fontSize: '0.95rem', flexShrink: 0
                        }}>
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700 }}>{c.name}</h3>
                            <span style={{
                              padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 700,
                              background: isHot ? 'rgba(239, 68, 68, 0.12)' : isWarm ? 'rgba(245, 158, 11, 0.12)' : c.interest_level === 'COLD' ? 'rgba(148, 163, 184, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                              color: isHot ? '#ef4444' : isWarm ? '#f59e0b' : c.interest_level === 'COLD' ? 'var(--text-secondary)' : '#10b981',
                              border: `1px solid ${isHot ? 'rgba(239, 68, 68, 0.3)' : isWarm ? 'rgba(245, 158, 11, 0.3)' : c.interest_level === 'COLD' ? 'rgba(148, 163, 184, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`
                            }}>
                              {isHot ? 'HOT LEAD' : isWarm ? 'WARM LEAD' : c.interest_level === 'COLD' ? 'COLD LEAD' : 'UNCONTACTED'}
                            </span>
                            <LeadStepBadge
                              contact={c}
                              counselorName={counselors.find(cns => cns.id === c.assigned_counselor_id)?.name}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px', flexWrap: 'wrap' }}>
                            <span>{c.phone_number}</span>
                            {c.email && <span>{c.email}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Counselor Assignment & Score */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
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
                              <option key={cns.id} value={cns.id}>
                                {cns.name} {cns.availability_status === 'OnLeave' ? '(On Leave)' : ''}
                              </option>
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

                    {/* Admissions Pipeline Journey Stepper */}
                    <LeadJourneyStepper
                      contact={c}
                      counselorName={counselors.find(cns => cns.id === c.assigned_counselor_id)?.name}
                    />

                    {/* Key Indicators */}
                    {c.score_reasons && c.score_reasons.length > 0 && (
                      <div style={{ background: 'var(--bg-tertiary)', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
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

                    {/* Counselor Note Preview */}
                    {c.notes && (
                      <div style={{ background: 'rgba(245, 158, 11, 0.08)', padding: '10px 14px', borderRadius: '8px', borderLeft: '3px solid #f59e0b', fontSize: '0.85rem' }}>
                        <strong style={{ color: '#f59e0b' }}>Latest Note:</strong> {c.notes}
                      </div>
                    )}

                    {/* Action Toolbar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '12px', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {activeWorkspace === 'queue' ? (
                          <>
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: '0.82rem', padding: '7px 13px' }}
                              onClick={() => triggerCall(c)}
                            >
                              <Phone size={14} />
                              Call Lead Now
                            </button>

                            <button
                              className="btn btn-secondary"
                              style={{
                                fontSize: '0.82rem', padding: '7px 13px',
                                background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)',
                                display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700
                              }}
                              onClick={() => {
                                setCompleteContact(c);
                                setCompleteOutcome('Campus Visit Scheduled');
                                setCompleteNote('');
                              }}
                            >
                              <CheckCircle size={14} />
                              Mark Completed
                            </button>

                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.82rem', padding: '7px 13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                              onClick={() => openActivityHistory(c)}
                            >
                              <History size={14} />
                              Log Activity / History
                            </button>

                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.82rem', padding: '7px 13px' }}
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
                          </>
                        ) : (
                          <>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: '6px',
                              padding: '6px 14px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 700,
                              background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)'
                            }}>
                              <CheckCircle2 size={16} />
                              Completed by {counselors.find(cns => cns.id === c.assigned_counselor_id)?.name || 'Counselor'}
                            </span>

                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.82rem', padding: '7px 13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                              onClick={() => handleReopenFollowUp(c)}
                            >
                              <RotateCcw size={14} />
                              Reopen Follow-up
                            </button>

                            <button
                              className="btn btn-secondary"
                              style={{ fontSize: '0.82rem', padding: '7px 13px', display: 'flex', alignItems: 'center', gap: '6px' }}
                              onClick={() => openActivityHistory(c)}
                            >
                              <History size={14} />
                              Activity History
                            </button>
                          </>
                        )}
                      </div>

                      {onViewContact && (
                        <button
                          onClick={() => onViewContact(c.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                          Full Profile & Transcripts <ChevronRight size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : activeWorkspace === 'roster' ? (
        /* Counselors Roster Workspace */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700 }}>Counselors Roster & Capacity</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                Manage team availability status (Available, In Consultation, On Leave) and monitor active lead capacity.
              </p>
            </div>
            <button
              onClick={() => setShowAddCounselor(true)}
              className="btn btn-primary"
              style={{ fontSize: '0.85rem', padding: '10px 18px', display: 'flex', alignItems: 'center', gap: '8px' }}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '16px' }}>
              {counselors.map(cns => {
                const statusColor = cns.availability_status === 'Available' ? '#10b981' : cns.availability_status === 'InConsultation' ? '#f59e0b' : '#ef4444';
                const capacityPct = Math.min(100, Math.round((cns.active_lead_count / (cns.max_capacity || 50)) * 100));

                return (
                  <div key={cns.id} className="glass-panel hover-lift" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          width: '44px', height: '44px', borderRadius: '50%',
                          background: 'rgba(124, 58, 237, 0.12)', color: 'var(--accent-primary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.05rem'
                        }}>
                          {cns.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700 }}>{cns.name}</h4>
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

                    {/* Availability Toggle Selector */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Availability Status
                        </span>
                        <span style={{
                          fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: '12px',
                          background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}40`
                        }}>
                          {cns.availability_status || 'Available'}
                        </span>
                      </div>
                      <select
                        value={cns.availability_status || 'Available'}
                        onChange={(e) => handleUpdateAvailability(cns.id, e.target.value as any)}
                        style={{
                          background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
                          padding: '6px 10px', borderRadius: '6px', color: 'var(--text-primary)',
                          fontSize: '0.82rem', outline: 'none', cursor: 'pointer'
                        }}
                      >
                        <option value="Available">🟢 Available (Accepting Leads)</option>
                        <option value="InConsultation">🟡 In Consultation (Temporarily Busy)</option>
                        <option value="OnLeave">🔴 On Leave (Skip Auto-Assign)</option>
                      </select>
                    </div>

                    {/* Active Capacity Bar */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Workload Capacity</span>
                        <span style={{ fontWeight: 700 }}>{cns.active_lead_count} / {cns.max_capacity || 50} leads</span>
                      </div>
                      <div style={{ height: '7px', borderRadius: '999px', background: 'rgba(127,127,127,0.15)', overflow: 'hidden' }}>
                        <div style={{
                          width: `${capacityPct}%`,
                          height: '100%',
                          background: capacityPct > 80 ? '#ef4444' : capacityPct > 50 ? '#f59e0b' : 'var(--accent-primary)',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.82rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Counselor Performance Analytics Workspace */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700 }}>Counselor Performance Analytics</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                Conversion rates, average response times, and follow-up activities completed per counselor.
              </p>
            </div>
            <button
              onClick={fetchAnalytics}
              className="btn btn-secondary"
              style={{ fontSize: '0.82rem', padding: '8px 14px' }}
            >
              <RefreshCw size={14} className={loadingAnalytics ? 'spin' : ''} />
              Refresh Analytics
            </button>
          </div>

          {loadingAnalytics ? (
            <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
              <div>Computing counselor analytics...</div>
            </div>
          ) : analytics.length === 0 ? (
            <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Award size={40} style={{ margin: '0 auto 12px', opacity: 0.4 }} />
              <h3>No performance data recorded yet</h3>
              <p style={{ marginTop: '4px', fontSize: '0.9rem' }}>Assign leads to counselors and log follow-up outcomes to see metrics here.</p>
            </div>
          ) : (
            <>
              {/* Top Leaderboard Grid */}
              {(() => {
                const maxConv = Math.max(...analytics.map(a => a.conversion_rate || 0), 0);
                const maxComp = Math.max(...analytics.map(a => a.completed_count || 0), 0);

                return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '16px' }}>
                    {analytics.map((item) => {
                      const isTop = (maxConv > 0 || maxComp > 0) && item.conversion_rate === maxConv && item.completed_count > 0;

                      return (
                        <div key={item.counselor_id} className="glass-panel hover-lift" style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <div style={{
                                width: '42px', height: '42px', borderRadius: '50%',
                                background: isTop ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'rgba(124, 58, 237, 0.12)',
                                color: isTop ? '#fff' : 'var(--accent-primary)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                              }}>
                                {isTop ? <Award size={20} /> : item.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <h4 style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem', fontWeight: 700 }}>{item.name}</h4>
                                  {isTop && <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', fontWeight: 700 }}>Top Performer</span>}
                                </div>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.email}</span>
                              </div>
                            </div>

                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)', fontFamily: 'var(--font-display)' }}>
                                {item.conversion_rate}%
                              </div>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Conversion</span>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{item.completed_count}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>Completed</div>
                            </div>
                            <div style={{ textAlign: 'center', borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)' }}>
                              <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{item.activity_count_7d}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>7d Actions</div>
                            </div>
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{item.avg_response_hours !== null ? `${item.avg_response_hours}h` : '—'}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>Avg Response</div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            <span>Active Leads: <strong>{item.active_leads}</strong></span>
                            <span>Hot Leads Handled: <strong>{item.hot_leads_assigned}</strong></span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* Activity History Modal / Drawer */}
      {activeHistoryContact && (
        <div className="modal-overlay" onClick={() => setActiveHistoryContact(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '28px', maxWidth: '640px', width: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '14px' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700 }}>
                  Follow-Up History: {activeHistoryContact.name}
                </h3>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{activeHistoryContact.phone_number}</span>
              </div>
              <button onClick={() => setActiveHistoryContact(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Quick Log New Action Box */}
            <form onSubmit={submitNewActivity} style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Log New Counselor Action
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {['Call', 'WhatsApp', 'Email', 'CampusVisit', 'Note'].map(type => (
                  <button
                    type="button"
                    key={type}
                    onClick={() => setNewActionType(type)}
                    className={`btn ${newActionType === type ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '0.78rem', padding: '5px 12px' }}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.78rem' }}>Outcome / Disposition</label>
                <input
                  type="text"
                  placeholder="e.g. Call Connected, Parent Requested Fee Structure, Scheduled Tour"
                  className="form-input"
                  style={{ fontSize: '0.85rem' }}
                  value={newActionOutcome}
                  onChange={(e) => setNewActionOutcome(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: '0.78rem' }}>Notes & Key Takeaways</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Detailed notes from interaction..."
                  style={{ fontSize: '0.85rem', resize: 'vertical' }}
                  value={newActionNotes}
                  onChange={(e) => setNewActionNotes(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="btn btn-primary" style={{ fontSize: '0.82rem', padding: '6px 14px' }} disabled={loggingActivity}>
                  {loggingActivity ? 'Logging...' : 'Save Activity'}
                </button>
              </div>
            </form>

            {/* Timeline of Past Activities */}
            <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '12px' }}>Past Activity Log</div>
            {loadingActivities ? (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                <RefreshCw size={20} className="spin" style={{ margin: '0 auto 8px' }} />
                Loading history...
              </div>
            ) : activityHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No activities logged yet for this lead.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {activityHistory.map(act => (
                  <div key={act.id} style={{ background: 'var(--bg-secondary)', padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase' }}>
                        {act.action_type} • {act.outcome || 'Logged'}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {act.created_at ? new Date(act.created_at).toLocaleString() : ''}
                      </span>
                    </div>
                    {act.notes && <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', marginTop: '4px' }}>{act.notes}</p>}
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>By: {act.counselor_name || 'System'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Onboard Counselor Modal */}
      {showAddCounselor && (
        <div className="modal-overlay" onClick={() => setShowAddCounselor(false)}>
          <form onSubmit={handleOnboardCounselor} onClick={(e) => e.stopPropagation()} className="modal-content" style={{ padding: '28px', maxWidth: '480px', width: '100%', background: 'var(--bg-secondary)' }}>
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

      {/* Credentials Created Modal */}
      {counselorCredentials && (
        <div className="modal-overlay" onClick={() => setCounselorCredentials(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '28px', maxWidth: '480px', width: '100%', borderLeft: '5px solid var(--accent-success)', background: 'var(--bg-secondary)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 700, marginBottom: '10px', color: 'var(--text-primary)' }}>
              Counselor Login Created
            </h3>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
              An invitation email has been sent to <strong>{counselorCredentials.name}</strong> to set their password. Here are their temporary credentials:
            </p>

            <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px', border: '1px solid var(--border-color)' }}>
              <div>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Email Address</span>
                <span style={{ fontSize: '0.92rem', fontWeight: 600 }}>{counselorCredentials.email}</span>
              </div>
              {counselorCredentials.password && (
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', fontWeight: 700 }}>Temporary Password</span>
                  <span style={{ fontSize: '0.92rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--accent-primary)' }}>{counselorCredentials.password}</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              {counselorCredentials.password && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    navigator.clipboard.writeText(`Email: ${counselorCredentials.email}\nPassword: ${counselorCredentials.password}`);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? 'Copied!' : 'Copy Credentials'}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setCounselorCredentials(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Mark Completed Modal */}
      {completeContact && (
        <div className="modal-overlay" onClick={() => setCompleteContact(null)}>
          <form onSubmit={handleCompleteFollowUp} onClick={(e) => e.stopPropagation()} className="modal-content" style={{ padding: '28px', maxWidth: '520px', width: '100%', borderLeft: '5px solid #10b981', background: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '8px', borderRadius: '50%' }}>
                  <CheckCircle size={22} />
                </div>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Complete Follow-up: {completeContact.name}
                  </h3>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{completeContact.phone_number}</span>
                </div>
              </div>
              <button type="button" onClick={() => setCompleteContact(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Call Outcome / Disposition</label>
                <select
                  className="form-input"
                  value={completeOutcome}
                  onChange={(e) => setCompleteOutcome(e.target.value)}
                  style={{ background: 'var(--bg-tertiary)', fontWeight: 600, color: 'var(--text-primary)' }}
                >
                  <option value="Campus Visit Scheduled">Campus Visit Scheduled</option>
                  <option value="Enrollment Discussion In-Progress">Enrollment Discussion In-Progress</option>
                  <option value="Parent Enrolled / Fee Paid">Parent Enrolled / Fee Paid</option>
                  <option value="General Enquiry Resolved">General Enquiry Resolved</option>
                  <option value="Follow-up Completed (Parent Satisfied)">Follow-up Completed (Parent Satisfied)</option>
                  <option value="Not Interested / Dropped">Not Interested / Dropped</option>
                  <option value="Invalid Contact / Wrong Number">Invalid Contact / Wrong Number</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Counselor Observations / Notes</label>
                <textarea
                  className="form-input"
                  rows={4}
                  value={completeNote}
                  onChange={(e) => setCompleteNote(e.target.value)}
                  placeholder="e.g. Spoke with parent regarding Grade 5 admission. Confirmed campus tour on Saturday at 11 AM with admissions team."
                  style={{ resize: 'vertical', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setCompleteContact(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ background: '#10b981', borderColor: '#10b981', color: '#ffffff' }} disabled={completing}>
                {completing ? 'Completing...' : 'Mark as Completed'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleContact && (
        <div className="modal-overlay" onClick={() => setRescheduleContact(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '28px', maxWidth: '500px', width: '100%', background: 'var(--bg-secondary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Schedule Callback: {rescheduleContact.name}
              </h3>
              <button onClick={() => setRescheduleContact(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ color: 'var(--text-primary)' }}>Callback Date & Time</label>
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
