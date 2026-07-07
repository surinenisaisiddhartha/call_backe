import React, { useEffect, useState } from 'react';
import api from '../api';
import {
  Calendar, Trash2, Edit2, CalendarRange, RefreshCw, Plus, X, Search, Phone,
  CalendarCheck, CheckCircle, Clock, XCircle, User
} from 'lucide-react';

interface ScheduledCallback {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  scheduled_for: string;
  google_calendar_event_id: string | null;
  status: 'Scheduled' | 'Triggered' | 'Cancelled';
  call_type: string;
  reason?: string;
}

interface Appointment {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  scheduled_for: string;
  purpose: string | null;
  google_calendar_event_id: string | null;
  calcom_booking_id: string | null;
  status: 'Booked' | 'Cancelled' | 'Completed';
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  phone_number: string;
  email: string | null;
  status: string;
}

interface SchedulingProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

const APPOINTMENT_STATUS_COLORS: Record<string, string> = {
  Booked: 'var(--accent-primary)',
  Completed: 'var(--accent-success)',
  Cancelled: 'var(--accent-error)',
};

const APPOINTMENT_STATUS_BG: Record<string, string> = {
  Booked: 'rgba(99,102,241,0.15)',
  Completed: 'rgba(34,197,94,0.15)',
  Cancelled: 'rgba(239,68,68,0.15)',
};

const PURPOSE_EMOJIS: Record<string, string> = {
  'campus tour': '🏫',
  'admission counseling': '📋',
  'counseling': '🎓',
  'visit': '👀',
  'demo': '🖥️',
  'meeting': '🤝',
};

function purposeEmoji(purpose: string | null) {
  if (!purpose) return '📅';
  const lower = purpose.toLowerCase();
  for (const [key, emoji] of Object.entries(PURPOSE_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return '📅';
}

export default function Scheduling({ showToast }: SchedulingProps) {
  const [subTab, setSubTab] = useState<'callbacks' | 'appointments'>('callbacks');
  const [loading, setLoading] = useState(true);

  const getLocalDateStr = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    } catch {
      return '';
    }
  };

  const toLocalDateTimeString = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${y}-${m}-${day}T${h}:${min}`;
    } catch {
      return '';
    }
  };

  // --- 1. Callbacks States ---
  const [schedules, setSchedules] = useState<ScheduledCallback[]>([]);
  const [editCallback, setEditCallback] = useState<ScheduledCallback | null>(null);
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [savingCallback, setSavingCallback] = useState(false);

  // New Schedule Callback Modal States
  const [showNewScheduleModal, setShowNewScheduleModal] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [callType, setCallType] = useState<'Follow-up' | 'Reminder' | 'Check-in'>('Follow-up');
  const [schedulingCallback, setSchedulingCallback] = useState(false);

  // Callback Calendar Filter States
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
  const [showMonthYearPicker, setShowMonthYearPicker] = useState(false);
  const [dayDrawerOpen, setDayDrawerOpen] = useState(false);
  const [dayDrawerDate, setDayDrawerDate] = useState<string | null>(null);



  // --- 2. Appointments States ---
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentFilter, setAppointmentFilter] = useState<string>('all');
  const [editApt, setEditApt] = useState<Appointment | null>(null);
  const [editAptTime, setEditAptTime] = useState('');
  const [editAptPurpose, setEditAptPurpose] = useState('');
  const [savingApt, setSavingApt] = useState(false);

  // Create Appointment Modal States
  const [showCreateApt, setShowCreateApt] = useState(false);
  const [aptContacts, setAptContacts] = useState<{ id: string; name: string; phone_number: string }[]>([]);
  const [newAptContactId, setNewAptContactId] = useState('');
  const [newAptTime, setNewAptTime] = useState('');
  const [newAptPurpose, setNewAptPurpose] = useState('');
  const [creatingApt, setCreatingApt] = useState(false);

  // --- Fetch Handlers ---
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    await Promise.all([fetchSchedules(), fetchAppointments()]);
    setLoading(false);
  };

  const fetchSchedules = async () => {
    try {
      const res = await api.get('/schedule');
      setSchedules(res.data);
    } catch (err: any) {
      console.error('Error fetching schedules:', err);
    }
  };

  const fetchAppointments = async () => {
    try {
      const res = await api.get('/appointments');
      setAppointments(res.data);
    } catch (err) {
      console.error('Failed to load appointments', err);
    }
  };

  // --- Callback Event Actions ---
  const cancelCallback = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this scheduled callback call? This will delete the calendar event.')) return;
    try {
      await api.delete(`/schedule/${id}`);
      showToast('Scheduled call cancelled successfully', 'success');
      fetchSchedules();
    } catch (err: any) {
      showToast('Failed to cancel scheduled call', 'error');
    }
  };

  const openEditCallback = (cb: ScheduledCallback) => {
    setEditCallback(cb);
    setRescheduleTime(toLocalDateTimeString(cb.scheduled_for));
  };

  const saveRescheduleCallback = async () => {
    if (!editCallback) return;
    setSavingCallback(true);
    try {
      await api.put(`/schedule/${editCallback.id}`, {
        scheduledFor: rescheduleTime
      });
      showToast('Scheduled call updated successfully', 'success');
      setEditCallback(null);
      fetchSchedules();
    } catch (err: any) {
      showToast('Failed to update schedule time', 'error');
    } finally {
      setSavingCallback(false);
    }
  };

  const openNewScheduleModalHandler = async () => {
    setShowNewScheduleModal(true);
    setSelectedContact(null);
    setContactSearch('');
    setCallType('Follow-up');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduledFor(tomorrow.toISOString().slice(0, 16));
    try {
      const res = await api.get('/contacts');
      setContacts(res.data);
    } catch (err) {
      console.error('Error fetching contacts:', err);
    }
  };

  const submitNewSchedule = async () => {
    if (!selectedContact) {
      showToast('Please select a contact', 'error');
      return;
    }
    setSchedulingCallback(true);
    try {
      await api.post('/schedule', {
        contactId: selectedContact.id,
        scheduledFor: scheduledFor,
        callType: callType
      });
      showToast(`${callType} scheduled for ${selectedContact.name}`, 'success');
      setShowNewScheduleModal(false);
      fetchSchedules();
    } catch (err: any) {
      showToast(err.response?.data?.detail || err.response?.data?.error || 'Failed to schedule callback', 'error');
    } finally {
      setSchedulingCallback(false);
    }
  };

  // --- Appointment Event Actions ---
  const openEditApt = (apt: Appointment) => {
    setEditApt(apt);
    setEditAptTime(toLocalDateTimeString(apt.scheduled_for));
    setEditAptPurpose(apt.purpose || '');
  };

  const saveEditApt = async () => {
    if (!editApt) return;
    setSavingApt(true);
    try {
      await api.patch(`/appointments/${editApt.id}`, {
        scheduled_for: editAptTime,
        purpose: editAptPurpose,
      });
      showToast('Appointment updated!', 'success');
      setEditApt(null);
      fetchAppointments();
    } catch {
      showToast('Failed to update appointment', 'error');
    } finally {
      setSavingApt(false);
    }
  };

  const markAptCompleted = async (id: string) => {
    try {
      await api.patch(`/appointments/${id}`, { status: 'Completed' });
      showToast('Marked as completed', 'success');
      fetchAppointments();
    } catch {
      showToast('Failed to update status', 'error');
    }
  };

  const deleteApt = async (id: string) => {
    if (!confirm('Cancel this appointment? This cannot be undone.')) return;
    try {
      await api.delete(`/appointments/${id}`);
      showToast('Appointment cancelled', 'success');
      fetchAppointments();
    } catch {
      showToast('Failed to cancel appointment', 'error');
    }
  };

  const openCreateAptHandler = async () => {
    setShowCreateApt(true);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setNewAptTime(tomorrow.toISOString().slice(0, 16));
    setNewAptPurpose('');
    setNewAptContactId('');
    try {
      const res = await api.get('/contacts');
      setAptContacts(res.data);
    } catch {}
  };

  const submitCreateApt = async () => {
    if (!newAptContactId || !newAptTime || !newAptPurpose) {
      showToast('Please fill in all fields', 'error');
      return;
    }
    setCreatingApt(true);
    try {
      await api.post('/appointments', {
        contact_id: newAptContactId,
        scheduled_for: newAptTime,
        purpose: newAptPurpose,
      });
      showToast('Appointment booked!', 'success');
      setShowCreateApt(false);
      fetchAppointments();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to create appointment', 'error');
    } finally {
      setCreatingApt(false);
    }
  };

  // --- Calendar & Filter Helpers ---
  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
    c.phone_number.includes(contactSearch)
  );

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const days = getDaysInMonth(year, month);
    const firstDay = new Date(year, month, 1).getDay();

    const monthName = currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const blanks = Array.from({ length: firstDay }, (_, i) => i);
    const monthDays = Array.from({ length: days }, (_, i) => i + 1);

    return (
      <div className="glass-panel" style={{ marginBottom: '24px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          {showMonthYearPicker ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <select
                value={currentMonth.getMonth()}
                onChange={(e) => {
                  const newMonth = parseInt(e.target.value);
                  setCurrentMonth(new Date(currentMonth.getFullYear(), newMonth, 1));
                }}
                className="form-input"
                style={{ padding: '6px 12px', fontSize: '0.9rem', width: '130px' }}
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>
                    {new Date(2000, i, 1).toLocaleString('default', { month: 'long' })}
                  </option>
                ))}
              </select>

              <select
                value={currentMonth.getFullYear()}
                onChange={(e) => {
                  const newYear = parseInt(e.target.value);
                  setCurrentMonth(new Date(newYear, currentMonth.getMonth(), 1));
                }}
                className="form-input"
                style={{ padding: '6px 12px', fontSize: '0.9rem', width: '100px' }}
              >
                {Array.from({ length: 10 }, (_, i) => {
                  const yr = new Date().getFullYear() - 5 + i;
                  return <option key={yr} value={yr}>{yr}</option>;
                })}
              </select>

              <button
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                onClick={() => setShowMonthYearPicker(false)}
              >
                Done
              </button>
            </div>
          ) : (
            <h3
              onClick={() => setShowMonthYearPicker(true)}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '1.25rem',
                margin: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title="Click to jump to another month/year"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'inherit'}
            >
              {monthName} <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>▼</span>
            </h3>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={prevMonth} style={{ padding: '6px 12px' }}>&larr;</button>
            <button className="btn btn-secondary" onClick={nextMonth} style={{ padding: '6px 12px' }}>&rarr;</button>
            {selectedDateFilter && (
              <button className="btn btn-danger" onClick={() => setSelectedDateFilter(null)} style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <X size={14} /> Clear Filter
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', textAlign: 'center' }}>
          {dayNames.map(d => (
            <div key={d} style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '8px' }}>{d}</div>
          ))}

          {blanks.map(b => (
            <div key={`blank-${b}`} style={{ padding: '10px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', opacity: 0.5 }}></div>
          ))}

          {monthDays.map(d => {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const itemsOnDay = subTab === 'callbacks'
              ? schedules.filter(s => getLocalDateStr(s.scheduled_for) === dateStr)
              : appointments.filter(a => getLocalDateStr(a.scheduled_for) === dateStr);
            const hasItems = itemsOnDay.length > 0;
            const isSelected = selectedDateFilter === dateStr;
            const isToday = new Date().toISOString().split('T')[0] === dateStr;
            const dotColor = subTab === 'callbacks' ? '#8b5cf6' : '#f59e0b';

            return (
              <div
                key={d}
                onClick={() => {
                  if (hasItems) {
                    setDayDrawerDate(dateStr);
                    setDayDrawerOpen(true);
                    setSelectedDateFilter(isSelected ? null : dateStr);
                  }
                }}
                style={{
                  padding: '10px',
                  background: isSelected ? 'rgba(99,102,241,0.2)' : 'var(--bg-secondary)',
                  border: `1px solid ${isSelected ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                  borderRadius: '8px',
                  cursor: hasItems ? 'pointer' : 'default',
                  minHeight: '80px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (!isSelected && hasItems) {
                    e.currentTarget.style.background = 'var(--bg-tertiary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'var(--bg-secondary)';
                  }
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '1rem', color: isToday ? 'var(--accent-primary)' : 'var(--text-primary)' }}>{d}</div>
                {hasItems && (
                  <div style={{
                    marginTop: 'auto',
                    display: 'flex',
                    gap: '4px',
                    alignItems: 'center'
                  }}>
                    {itemsOnDay.slice(0, 3).map((_, i) => (
                      <div key={i} style={{
                        width: '7px', height: '7px', borderRadius: '50%',
                        background: dotColor
                      }} />
                    ))}
                    {itemsOnDay.length > 3 && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>+{itemsOnDay.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const displayedSchedules = selectedDateFilter
    ? schedules.filter(s => getLocalDateStr(s.scheduled_for) === selectedDateFilter)
    : schedules;

  const filteredApts = appointmentFilter === 'all'
    ? appointments
    : appointments.filter(a => a.status === appointmentFilter);

  const aptStats = {
    total: appointments.length,
    booked: appointments.filter(a => a.status === 'Booked').length,
    completed: appointments.filter(a => a.status === 'Completed').length,
    cancelled: appointments.filter(a => a.status === 'Cancelled').length,
  };

  const upcomingApts = appointments
    .filter(a => a.status === 'Booked' && new Date(a.scheduled_for) > new Date())
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())
    .slice(0, 3);

  return (
    <div>
      {/* Tab Switcher and Actions Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-secondary)', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
            <button
              onClick={() => setSubTab('callbacks')}
              className={`btn ${subTab === 'callbacks' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '0.9rem', border: 'none' }}
            >
              Callbacks
            </button>
            <button
              onClick={() => setSubTab('appointments')}
              className={`btn ${subTab === 'appointments' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '0.9rem', border: 'none' }}
            >
              Appointments
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={fetchData} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCw size={16} /> Refresh
          </button>
          {subTab === 'callbacks' ? (
            <button
              className="btn btn-primary"
              onClick={openNewScheduleModalHandler}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Plus size={18} />
              New Callback
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={openCreateAptHandler}
              style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <Plus size={18} />
              New Appointment
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '40vh' }}>
          <RefreshCw className="animate-spin" style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-primary)' }} size={32} />
        </div>
      ) : (
        <div>
          {renderCalendar()}

          {/* Day Detail Drawer */}
          {dayDrawerOpen && dayDrawerDate && (() => {
            const items = subTab === 'callbacks'
              ? schedules.filter(s => getLocalDateStr(s.scheduled_for) === dayDrawerDate)
              : appointments.filter(a => getLocalDateStr(a.scheduled_for) === dayDrawerDate);
            const d = new Date(dayDrawerDate + 'T12:00:00');
            const headerStr = d.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' });
            return (
              <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px', borderLeft: `4px solid ${subTab === 'callbacks' ? '#8b5cf6' : '#f59e0b'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>{headerStr}</h4>
                  <button onClick={() => { setDayDrawerOpen(false); setDayDrawerDate(null); setSelectedDateFilter(null); }} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={18} /></button>
                </div>
                {items.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {subTab === 'callbacks' ? 'No callbacks on this day.' : 'No campus visits on this day.'}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {items.map((item: any) => {
                      const time = new Date(item.scheduled_for).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                      const statusLabel = subTab === 'callbacks'
                        ? (item.status === 'Scheduled' ? 'Pending' : item.status === 'Triggered' ? 'Fired' : item.status)
                        : item.status;
                      const statusColor = item.status === 'Scheduled' ? '#60a5fa' : item.status === 'Triggered' ? '#34d399' : item.status === 'Booked' ? 'var(--accent-primary)' : item.status === 'Completed' ? 'var(--accent-success)' : 'var(--accent-error)';
                      
                      return (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '12px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                              {time} — {item.contact_name}
                            </div>
                            {subTab === 'callbacks' ? (
                              item.reason && (
                                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>
                                  Requested callback: "{item.reason}"
                                </div>
                              )
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                {item.purpose && (
                                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    {item.purpose}
                                  </div>
                                )}
                                {item.google_calendar_event_id && (
                                  <a
                                    href={`https://calendar.google.com/calendar/r/event/${item.google_calendar_event_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-secondary"
                                    style={{
                                      padding: '4px 8px',
                                      fontSize: '0.75rem',
                                      width: 'fit-content',
                                      marginTop: '4px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}
                                  >
                                    Open in Google Calendar
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                          <span style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, color: statusColor, background: `${statusColor}1a`, border: `1px solid ${statusColor}33`, whiteSpace: 'nowrap' }}>
                            {statusLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {subTab === 'callbacks' ? (
            // ================= CALLBACKS TAB CONTENT =================
            <div>
              <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                {displayedSchedules.length === 0 ? (
                  <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {selectedDateFilter ? 'No callbacks on this day.' : 'No callbacks scheduled this month.'}
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="custom-table">
                      <thead>
                        <tr>
                          <th>Contact Name</th>
                          <th>Contact Phone</th>
                          <th>Call Type</th>
                          <th>Scheduled For</th>
                          <th>Calendar Sync</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'center' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedSchedules.map((s) => (
                          <tr key={s.id}>
                            <td style={{ fontWeight: 600 }}>{s.contact_name}</td>
                            <td>{s.contact_phone}</td>
                            <td>
                              <span className={`badge badge-${s.call_type.toLowerCase().replace('-', '')}`}>
                                {s.call_type}
                              </span>
                            </td>
                            <td>{new Date(s.scheduled_for).toLocaleString()}</td>
                            <td>
                              {s.google_calendar_event_id ? (
                                <span style={{ color: 'var(--accent-success)', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}>
                                  <CalendarRange size={14} /> Active
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>None</span>
                              )}
                            </td>
                            <td>
                              <span className={`badge badge-${s.status.toLowerCase()}`}>
                                {s.status === 'Scheduled' ? 'Pending' : s.status === 'Triggered' ? 'Fired' : s.status}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                                {s.status === 'Scheduled' && (
                                  <>
                                    <button
                                      className="btn btn-secondary"
                                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                      onClick={() => openEditCallback(s)}
                                    >
                                      <Edit2 size={12} />
                                      Edit
                                    </button>
                                    <button
                                      className="btn btn-danger"
                                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                      onClick={() => cancelCallback(s.id)}
                                    >
                                      <Trash2 size={12} />
                                      Cancel
                                    </button>
                                  </>
                                )}
                                {s.status !== 'Scheduled' && (
                                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // ================= APPOINTMENTS TAB CONTENT =================
            <div>
              {/* Stats Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '28px' }}>
                {[
                  { label: 'Total', value: aptStats.total, icon: <CalendarCheck size={22} />, color: '#a78bfa' },
                  { label: 'Upcoming', value: aptStats.booked, icon: <Clock size={22} />, color: '#60a5fa' },
                  { label: 'Completed', value: aptStats.completed, icon: <CheckCircle size={22} />, color: '#34d399' },
                  { label: 'Cancelled', value: aptStats.cancelled, icon: <XCircle size={22} />, color: '#f87171' },
                ].map(s => (
                  <div key={s.label} className="glass-panel" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: `${s.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color, flexShrink: 0 }}>
                      {s.icon}
                    </div>
                    <div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 800, lineHeight: 1 }}>{s.value}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Upcoming strip */}
              {upcomingApts.length > 0 && (
                <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '14px' }}>
                    ⚡ Next Up
                  </div>
                  <div style={{ display: 'flex', gap: '14px', overflowX: 'auto' }}>
                    {upcomingApts.map(apt => (
                      <div key={apt.id} style={{
                        flexShrink: 0, padding: '16px 20px', borderRadius: '12px',
                        background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)',
                        minWidth: '220px'
                      }}>
                        <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>{purposeEmoji(apt.purpose)}</div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{apt.contact_name}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '2px' }}>{apt.purpose || 'Visit'}</div>
                        <div style={{ color: 'var(--accent-primary)', fontSize: '0.82rem', fontWeight: 600, marginTop: '8px' }}>
                          {new Date(apt.scheduled_for).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Filter Tabs */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                {['all', 'Booked', 'Completed', 'Cancelled'].map(s => (
                  <button
                    key={s}
                    onClick={() => setAppointmentFilter(s)}
                    style={{
                      padding: '8px 18px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 600,
                      border: `1px solid ${appointmentFilter === s ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      background: appointmentFilter === s ? 'rgba(99,102,241,0.18)' : 'transparent',
                      color: appointmentFilter === s ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                  >
                    {s === 'all' ? 'All' : s}{' '}
                    <span style={{ opacity: 0.7 }}>
                      ({s === 'all' ? aptStats.total : s === 'Booked' ? aptStats.booked : s === 'Completed' ? aptStats.completed : aptStats.cancelled})
                    </span>
                  </button>
                ))}
              </div>

              {/* Table */}
              <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                {filteredApts.length === 0 ? (
                  <div style={{ padding: '80px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <CalendarCheck size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
                    <div style={{ fontSize: '1.1rem' }}>No campus visits scheduled this month.</div>
                    <div style={{ fontSize: '0.85rem', marginTop: '8px', opacity: 0.7 }}>
                      Appointments are auto-created when the AI agent books a visit during a call.
                    </div>
                  </div>
                ) : (
                  <div className="table-container">
                    <table className="custom-table">
                      <thead>
                        <tr>
                          <th>Contact</th>
                          <th>Purpose</th>
                          <th>Scheduled For</th>
                          <th>Cal.com</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'center' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredApts.map(apt => (
                          <tr key={apt.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(99,102,241,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  <User size={16} style={{ color: 'var(--accent-primary)' }} />
                                </div>
                                <div>
                                  <div style={{ fontWeight: 700 }}>{apt.contact_name}</div>
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Phone size={11} /> {apt.contact_phone}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1.2rem' }}>{purposeEmoji(apt.purpose)}</span>
                                <span style={{ fontWeight: 500 }}>{apt.purpose || <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ fontWeight: 600 }}>
                                {new Date(apt.scheduled_for).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </div>
                              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                {new Date(apt.scheduled_for).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </div>
                            </td>
                            <td>
                              {apt.calcom_booking_id ? (
                                <span style={{ color: 'var(--accent-success)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <CheckCircle size={14} /> #{apt.calcom_booking_id}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Not synced</span>
                              )}
                            </td>
                            <td>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '4px 12px', borderRadius: '20px', fontSize: '0.82rem', fontWeight: 700,
                                color: APPOINTMENT_STATUS_COLORS[apt.status], background: APPOINTMENT_STATUS_BG[apt.status],
                                border: `1px solid ${APPOINTMENT_STATUS_COLORS[apt.status]}44`
                              }}>
                                {apt.status === 'Booked' && <Clock size={12} />}
                                {apt.status === 'Completed' && <CheckCircle size={12} />}
                                {apt.status === 'Cancelled' && <XCircle size={12} />}
                                {apt.status}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
                                {apt.status === 'Booked' && (
                                  <>
                                    <button
                                      className="btn btn-secondary"
                                      style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                                      onClick={() => openEditApt(apt)}
                                      title="Reschedule"
                                    >
                                      <Edit2 size={12} />
                                    </button>
                                    <button
                                      className="btn btn-secondary"
                                      style={{ padding: '6px 10px', fontSize: '0.8rem', color: 'var(--accent-success)' }}
                                      onClick={() => markAptCompleted(apt.id)}
                                      title="Mark Completed"
                                    >
                                      <CheckCircle size={12} />
                                    </button>
                                    <button
                                      className="btn btn-danger"
                                      style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                                      onClick={() => deleteApt(apt.id)}
                                      title="Cancel"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </>
                                )}
                                {apt.status !== 'Booked' && (
                                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>—</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- CALLBACK MODALS --- */}
      {editCallback && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ padding: '30px' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '16px' }}>
              Reschedule Callback
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px' }}>
              Change the date/time for the follow-up call with {editCallback.contact_name}.
            </p>
            <div className="form-group">
              <label className="form-label">New Date & Time</label>
              <input
                type="datetime-local"
                className="form-input"
                value={rescheduleTime}
                onChange={(e) => setRescheduleTime(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setEditCallback(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRescheduleCallback} disabled={savingCallback}>
                {savingCallback ? 'Saving...' : 'Confirm Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewScheduleModal && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ padding: '30px', maxWidth: '600px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '4px' }}>
                  New Callback
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Select a contact and schedule time</p>
              </div>
              <button onClick={() => setShowNewScheduleModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">Select Contact</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '12px' }}>
                <Search size={16} style={{ color: 'var(--text-secondary)' }} />
                <input
                  type="text"
                  placeholder="Search by name or phone..."
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-primary)', outline: 'none', width: '100%', fontSize: '0.9rem' }}
                />
              </div>
              <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'rgba(0,0,0,0.2)' }}>
                {filteredContacts.length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    No contacts found
                  </div>
                ) : (
                  filteredContacts.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => setSelectedContact(c)}
                      style={{
                        padding: '10px 14px',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--border-color)',
                        background: selectedContact?.id === c.id ? 'rgba(99,102,241,0.15)' : 'transparent',
                        transition: 'background 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{c.phone_number}</div>
                        </div>
                        {selectedContact?.id === c.id && (
                          <div style={{ color: 'var(--accent-primary)' }}>
                            <Phone size={16} />
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '20px' }}>
              <label className="form-label">Call Type</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {(['Follow-up', 'Reminder', 'Check-in'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setCallType(type)}
                    style={{
                      flex: 1, padding: '10px', borderRadius: '8px',
                      border: `1px solid ${callType === type ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      background: callType === type ? 'rgba(99,102,241,0.15)' : 'transparent',
                      color: callType === type ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all 0.2s'
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Date & Time</label>
              <input
                type="datetime-local"
                className="form-input"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
              <button className="btn btn-secondary" onClick={() => setShowNewScheduleModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={submitNewSchedule}
                disabled={schedulingCallback}
              >
                {schedulingCallback ? 'Scheduling...' : 'Confirm Schedule'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- APPOINTMENTS MODALS --- */}
      {editApt && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ padding: '30px', maxWidth: '480px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>Reschedule Appointment</h3>
              <button onClick={() => setEditApt(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px' }}>
              Updating appointment for <strong>{editApt.contact_name}</strong>
            </p>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">New Date & Time</label>
              <input type="datetime-local" className="form-input" value={editAptTime} onChange={e => setEditAptTime(e.target.value)} />
            </div>
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Purpose</label>
              <input type="text" className="form-input" value={editAptPurpose} onChange={e => setEditAptPurpose(e.target.value)} placeholder="e.g. campus tour, admission counseling" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setEditApt(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEditApt} disabled={savingApt}>
                {savingApt ? 'Saving...' : 'Confirm Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateApt && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ padding: '30px', maxWidth: '480px', width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem' }}>📅 Book Appointment</h3>
              <button onClick={() => setShowCreateApt(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">Contact</label>
              <select className="form-input" value={newAptContactId} onChange={e => setNewAptContactId(e.target.value)}>
                <option value="">— Select a contact —</option>
                {aptContacts.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.phone_number})</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">Purpose</label>
              <input type="text" className="form-input" value={newAptPurpose} onChange={e => setNewAptPurpose(e.target.value)} placeholder="e.g. campus tour, admission counseling" />
            </div>
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label">Date & Time</label>
              <input type="datetime-local" className="form-input" value={newAptTime} onChange={e => setNewAptTime(e.target.value)} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button className="btn btn-secondary" onClick={() => setShowCreateApt(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={submitCreateApt} disabled={creatingApt}>
                {creatingApt ? 'Booking...' : '📅 Book Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
