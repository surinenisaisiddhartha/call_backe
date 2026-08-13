import React, { useEffect, useState, useCallback } from 'react';
import api, { getErrorMessage } from '../api';
import { exportToExcel } from '../utils/exportToExcel';
import {
  Music, Palette, Code, Zap, BookOpen, Star, Heart, Globe, Cpu, Mic,
  Calendar, Clock, User, Phone, CheckCircle, XCircle, RefreshCw,
  ChevronLeft, ChevronRight, FileSpreadsheet, Plus, Pencil, Trash2,
  DollarSign, Save, X, Settings
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────
interface ClassType {
  id: string; name: string; description: string; icon: string; color: string;
  fee: number; duration_minutes: number; max_per_slot: number; is_active: boolean; sort_order: number;
}
interface SlotInfo { time: string; booked: number; free: number; available: boolean; }
interface DayAvailability { date: string; label: string; total_free: number; slots: SlotInfo[]; }
interface Booking {
  id: string; class_type_id: string; class_type: string; booked_date: string; booked_time: string;
  student_name: string; phone_number: string; email: string | null; notes: string | null;
  fee: number; status: string; created_at: string;
}
interface Stats { upcoming_classes: number; awaiting_payment: number; slots_free_today: number; booked_value: number; }

interface ClassesProps { showToast: (msg: string, type?: 'success' | 'error') => void; }

// ── Icon map ───────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ReactNode> = {
  music: <Music size={20} />, dance: <Zap size={20} />, art: <Palette size={20} />,
  coding: <Code size={20} />, book: <BookOpen size={20} />, star: <Star size={20} />,
  heart: <Heart size={20} />, globe: <Globe size={20} />, cpu: <Cpu size={20} />, mic: <Mic size={20} />,
};
const ICON_OPTIONS = ['music','dance','art','coding','book','star','heart','globe','cpu','mic'];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string }> = {
  indigo: { bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.45)',  text: '#818cf8' },
  pink:   { bg: 'rgba(244,63,94,0.12)',   border: 'rgba(244,63,94,0.45)',   text: '#fb7185' },
  amber:  { bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.45)',  text: '#fbbf24' },
  green:  { bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.45)', text: '#34d399' },
  blue:   { bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.45)',  text: '#60a5fa' },
  purple: { bg: 'rgba(168,85,247,0.12)',  border: 'rgba(168,85,247,0.45)',  text: '#c084fc' },
  rose:   { bg: 'rgba(244,63,94,0.12)',   border: 'rgba(244,63,94,0.45)',   text: '#fb7185' },
  teal:   { bg: 'rgba(20,184,166,0.12)',  border: 'rgba(20,184,166,0.45)', text: '#2dd4bf' },
};
const COLOR_OPTIONS = ['indigo','pink','amber','green','blue','purple','rose','teal'];

function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  return `${h > 12 ? h - 12 : h}:${m.toString().padStart(2,'0')} ${ap}`;
}

const TIME_SLOTS = ['18:00','19:00','20:00','21:00'];

// ── Blank forms ────────────────────────────────────────────────────────────
const blankType = (): Partial<ClassType> => ({
  name:'', description:'', icon:'book', color:'indigo', fee:500, duration_minutes:60, max_per_slot:4, is_active:true, sort_order:0
});
const blankBooking = (types: ClassType[]) => ({
  class_type_id: types[0]?.id || '', booked_date:'', booked_time:'18:00',
  student_name:'', phone_number:'', email:'', notes:'', fee: types[0]?.fee || 500, status:'upcoming'
});

export default function Classes({ showToast }: ClassesProps) {
  const [classTypes, setClassTypes] = useState<ClassType[]>([]);
  const [availability, setAvailability] = useState<DayAvailability[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stats, setStats] = useState<Stats>({ upcoming_classes:0, awaiting_payment:0, slots_free_today:0, booked_value:0 });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Booking form
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [dateOffset, setDateOffset] = useState(0);
  const [studentName, setStudentName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');

  // Class type modal
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<Partial<ClassType>>(blankType());
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);

  // Booking edit modal
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [editingBooking, setEditingBooking] = useState<any>(null);

  const VISIBLE_DAYS = 7;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [typesRes, availRes, bookRes, statsRes] = await Promise.all([
        api.get('/classes/types'),
        api.get('/classes/availability', { params: { days: 21 } }),
        api.get('/classes/bookings'),
        api.get('/classes/stats'),
      ]);
      const types = typesRes.data || [];
      setClassTypes(types);
      setAvailability(availRes.data || []);
      setBookings(bookRes.data || []);
      setStats(statsRes.data || {});
      if (types.length && !selectedClassId) setSelectedClassId(types[0].id);
      if (availRes.data?.length && !selectedDate) setSelectedDate(availRes.data[0].date);
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to load classes'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Class Type CRUD ───────────────────────────────────────────────────────
  const openAddType = () => { setEditingTypeId(null); setEditingType(blankType()); setShowTypeModal(true); };
  const openEditType = (ct: ClassType) => { setEditingTypeId(ct.id); setEditingType({...ct}); setShowTypeModal(true); };

  const saveType = async () => {
    if (!editingType.name?.trim()) { showToast('Class name is required', 'error'); return; }
    setSubmitting(true);
    try {
      if (editingTypeId) {
        await api.put(`/classes/types/${editingTypeId}`, editingType);
        showToast('Class type updated ✅', 'success');
      } else {
        await api.post('/classes/types', editingType);
        showToast('Class type added ✅', 'success');
      }
      setShowTypeModal(false);
      fetchAll();
    } catch (err) { showToast(getErrorMessage(err, 'Save failed'), 'error'); }
    finally { setSubmitting(false); }
  };

  const deleteType = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? Existing bookings will remain.`)) return;
    try {
      await api.delete(`/classes/types/${id}`);
      showToast('Class type deleted', 'success');
      fetchAll();
    } catch (err) { showToast(getErrorMessage(err, 'Delete failed'), 'error'); }
  };

  // ── Booking submit ────────────────────────────────────────────────────────
  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || !selectedDate || !selectedTime) {
      showToast('Select a class, date and time first', 'error'); return;
    }
    if (!studentName.trim() || !phone.trim()) {
      showToast('Student name and phone are required', 'error'); return;
    }
    setSubmitting(true);
    try {
      const ct = classTypes.find(c => c.id === selectedClassId);
      await api.post('/classes/bookings', {
        class_type_id: selectedClassId, booked_date: selectedDate, booked_time: selectedTime,
        student_name: studentName.trim(), phone_number: phone.trim(),
        email: email.trim() || null, notes: notes.trim() || null,
        fee: ct?.fee,
      });
      showToast('Class booked! 🎉', 'success');
      setStudentName(''); setPhone(''); setEmail(''); setNotes(''); setSelectedTime('');
      fetchAll();
    } catch (err) { showToast(getErrorMessage(err, 'Booking failed'), 'error'); }
    finally { setSubmitting(false); }
  };

  // ── Booking edit/cancel ───────────────────────────────────────────────────
  const openEditBooking = (b: Booking) => { setEditingBooking({ ...b }); setShowBookingModal(true); };

  const saveBooking = async () => {
    if (!editingBooking) return;
    setSubmitting(true);
    try {
      await api.put(`/classes/bookings/${editingBooking.id}`, editingBooking);
      showToast('Booking updated ✅', 'success');
      setShowBookingModal(false);
      fetchAll();
    } catch (err) { showToast(getErrorMessage(err, 'Update failed'), 'error'); }
    finally { setSubmitting(false); }
  };

  const cancelBooking = async (id: string) => {
    if (!window.confirm('Cancel this booking?')) return;
    try {
      await api.delete(`/classes/bookings/${id}`);
      showToast('Booking cancelled', 'success');
      fetchAll();
    } catch (err) { showToast(getErrorMessage(err, 'Cancel failed'), 'error'); }
  };

  const handleExport = () => {
    exportToExcel(bookings, [
      { header: 'Student Name', key: 'student_name' },
      { header: 'Phone', key: 'phone_number' },
      { header: 'Email', key: (b: Booking) => b.email || '' },
      { header: 'Class', key: 'class_type' },
      { header: 'Date', key: 'booked_date' },
      { header: 'Time', key: 'booked_time' },
      { header: 'Fee (₹)', key: (b: Booking) => String(b.fee) },
      { header: 'Status', key: 'status' },
      { header: 'Notes', key: (b: Booking) => b.notes || '' },
    ], 'Class_Bookings');
  };

  const visibleDays = availability.slice(dateOffset, dateOffset + VISIBLE_DAYS);
  const selectedDayData = availability.find(d => d.date === selectedDate);
  const selectedSlots = selectedDayData?.slots || [];
  const selectedClass = classTypes.find(c => c.id === selectedClassId);
  const colors = selectedClass ? (COLOR_MAP[selectedClass.color] || COLOR_MAP.indigo) : COLOR_MAP.indigo;

  if (loading) return (
    <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
      <RefreshCw size={32} style={{ animation: 'spin 1.5s linear infinite', color: 'var(--accent-primary)' }} />
      <p style={{ color: 'var(--text-muted)' }}>Loading classes…</p>
    </div>
  );

  return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: 800, marginBottom: 4 }}>Classes</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem' }}>Book a one-hour evening class. Sessions run 6 PM – 10 PM.</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={handleExport}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
            <FileSpreadsheet size={16} /> Export
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        {[
          { label: 'Upcoming classes',  value: stats.upcoming_classes,   icon: <Calendar size={18}/> },
          { label: 'Awaiting payment',  value: stats.awaiting_payment,   icon: <Clock size={18}/> },
          { label: 'Slots free today',  value: stats.slots_free_today,   icon: <CheckCircle size={18}/> },
          { label: 'Booked value',      value: `₹${stats.booked_value.toLocaleString()}`, icon: <DollarSign size={18}/> },
        ].map((s, i) => (
          <div key={i} className="glass-panel" style={{ padding: '20px 22px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 8 }}>{s.label}</p>
            <p style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'var(--font-display)' }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Step 1: Choose class */}
      <div className="glass-panel" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-muted)' }}>1 ·</span> Choose a class
          </h2>
          <button onClick={openAddType} className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', padding: '6px 14px', background: 'rgba(99,102,241,0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(99,102,241,0.3)' }}>
            <Plus size={14} /> Add Class Type
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
          {classTypes.filter(c => c.is_active).map((ct) => {
            const c = COLOR_MAP[ct.color] || COLOR_MAP.indigo;
            const isSel = selectedClassId === ct.id;
            return (
              <div key={ct.id} style={{ position: 'relative' }}>
                <button onClick={() => setSelectedClassId(ct.id)} style={{
                  width: '100%', padding: 16, borderRadius: 12,
                  border: `2px solid ${isSel ? c.border : 'var(--border-color)'}`,
                  background: isSel ? c.bg : 'var(--bg-tertiary)',
                  cursor: 'pointer', textAlign: 'left', transition: 'all 0.18s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ color: isSel ? c.text : 'var(--text-muted)' }}>{ICON_MAP[ct.icon] || <BookOpen size={20}/>}</span>
                    <span style={{ fontWeight: 700, fontSize: '0.96rem', color: isSel ? c.text : 'var(--text-primary)', flex: 1 }}>{ct.name}</span>
                    {isSel && <CheckCircle size={15} style={{ color: c.text }} />}
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{ct.description}</p>
                  <p style={{ fontSize: '0.78rem', color: c.text, marginTop: 6, fontWeight: 600 }}>₹{ct.fee} · {ct.duration_minutes} min</p>
                </button>
                {/* Edit/Delete on hover */}
                <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
                  <button onClick={() => openEditType(ct)} title="Edit" style={{
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                    borderRadius: 6, padding: '3px 6px', cursor: 'pointer', color: 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', opacity: 0.7
                  }}>
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => deleteType(ct.id, ct.name)} title="Delete" style={{
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                    borderRadius: 6, padding: '3px 6px', cursor: 'pointer', color: '#ef4444',
                    display: 'flex', alignItems: 'center', opacity: 0.7
                  }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Step 2: Pick date */}
      <div className="glass-panel" style={{ padding: 24 }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar size={18} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-muted)' }}>2 ·</span> Pick a date
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 16 }}>Evening sessions only — 6 PM to 10 PM.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setDateOffset(Math.max(0, dateOffset - VISIBLE_DAYS))} disabled={dateOffset === 0}
            className="btn btn-secondary btn-icon" style={{ opacity: dateOffset === 0 ? 0.3 : 1 }}>
            <ChevronLeft size={16} />
          </button>
          <div style={{ display: 'flex', gap: 8, flex: 1, overflowX: 'auto' }}>
            {visibleDays.map((day) => {
              const isSel = selectedDate === day.date;
              return (
                <button key={day.date} onClick={() => { setSelectedDate(day.date); setSelectedTime(''); }}
                  style={{
                    minWidth: 90, padding: '10px 14px', borderRadius: 10, textAlign: 'center',
                    border: `2px solid ${isSel ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: isSel ? 'rgba(99,102,241,0.15)' : 'var(--bg-tertiary)',
                    cursor: day.total_free > 0 ? 'pointer' : 'not-allowed',
                    opacity: day.total_free > 0 ? 1 : 0.4, transition: 'all 0.15s',
                  }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isSel ? 'var(--accent-primary)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{day.label}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 3 }}>{day.total_free} free</div>
                </button>
              );
            })}
          </div>
          <button onClick={() => setDateOffset(Math.min(availability.length - VISIBLE_DAYS, dateOffset + VISIBLE_DAYS))}
            disabled={dateOffset + VISIBLE_DAYS >= availability.length}
            className="btn btn-secondary btn-icon" style={{ opacity: dateOffset + VISIBLE_DAYS >= availability.length ? 0.3 : 1 }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Step 3: Pick time */}
      <div className="glass-panel" style={{ padding: 24 }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock size={18} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-muted)' }}>3 ·</span> Pick a time
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 16 }}>Each class is one hour.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {selectedSlots.length === 0
            ? <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Select a date first.</p>
            : selectedSlots.map((slot) => {
                const isSel = selectedTime === slot.time;
                return (
                  <button key={slot.time} onClick={() => slot.available && setSelectedTime(slot.time)}
                    style={{
                      minWidth: 110, padding: '12px 16px', borderRadius: 10, textAlign: 'center',
                      border: `2px solid ${isSel ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      background: isSel ? 'rgba(99,102,241,0.15)' : slot.available ? 'var(--bg-tertiary)' : 'rgba(0,0,0,0.1)',
                      cursor: slot.available ? 'pointer' : 'not-allowed', opacity: slot.available ? 1 : 0.4,
                      transition: 'all 0.15s',
                    }}>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: isSel ? 'var(--accent-primary)' : 'var(--text-primary)' }}>{formatTime(slot.time)}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {slot.available ? `${slot.free} left` : 'Full'}
                    </div>
                  </button>
                );
              })
          }
        </div>
      </div>

      {/* Step 4: Student details */}
      <div className="glass-panel" style={{ padding: 24 }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
          <User size={18} style={{ color: 'var(--text-muted)' }} />
          <span style={{ color: 'var(--text-muted)' }}>4 ·</span> Student details
        </h2>
        <form onSubmit={handleBook}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 16, marginBottom: 16 }}>
            {[
              { label: 'Student name *', ph: 'Full name', val: studentName, set: setStudentName, type: 'text' },
              { label: 'Phone number *', ph: '+91 98765 43210', val: phone, set: setPhone, type: 'tel' },
              { label: 'Email', ph: 'optional', val: email, set: setEmail, type: 'email' },
            ].map(({ label, ph, val, set, type }) => (
              <div key={label}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{label}</label>
                <input type={type} className="form-input" placeholder={ph} value={val} onChange={e => set(e.target.value)} style={{ width: '100%' }} />
              </div>
            ))}
            <div>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Anything we should know?</label>
              <textarea className="form-input" placeholder="optional" value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ width: '100%', resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '16px 20px' }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: '1rem' }}>₹{selectedClass?.fee || 500} · {selectedClass?.duration_minutes || 60} min</p>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {selectedClass && selectedDate && selectedTime
                  ? `${selectedClass.name} · ${selectedDate} · ${formatTime(selectedTime)}`
                  : 'Pick a date and time to continue.'}
              </p>
            </div>
            <button type="submit" disabled={!selectedClassId || !selectedDate || !selectedTime || submitting}
              style={{
                padding: '12px 24px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: '0.95rem',
                background: selectedClassId && selectedDate && selectedTime ? 'var(--accent-primary)' : 'rgba(99,102,241,0.25)',
                color: 'white', cursor: selectedClassId && selectedDate && selectedTime ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
              }}>
              {submitting ? <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Booking…</> : `Pay ₹${selectedClass?.fee || 500} & book`}
            </button>
          </div>
        </form>
      </div>

      {/* All Bookings */}
      <div className="glass-panel" style={{ padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>
            Upcoming bookings
            <span style={{ marginLeft: 8, fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              {bookings.filter(b => b.status === 'upcoming').length}
            </span>
          </h2>
          <button onClick={openAddType} className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '5px 12px' }}>
            <Plus size={13}/> Add Booking
          </button>
        </div>

        {bookings.filter(b => b.status !== 'cancelled').length === 0
          ? <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No classes booked yet.</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {bookings.filter(b => b.status !== 'cancelled').map((b) => {
                const ct = classTypes.find(c => c.id === b.class_type_id);
                const c = COLOR_MAP[ct?.color || 'indigo'] || COLOR_MAP.indigo;
                const statusColors: Record<string,string> = { upcoming: '#34d399', completed: '#60a5fa', cancelled: '#ef4444' };
                return (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-tertiary)', borderRadius: 10, padding: '14px 18px', border: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
                    <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, background: c.bg, color: c.text, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>
                      {ICON_MAP[ct?.icon || 'book']}&nbsp;{b.class_type}
                    </span>
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <p style={{ fontWeight: 700, fontSize: '0.92rem' }}>{b.student_name}</p>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{b.phone_number}{b.email ? ` · ${b.email}` : ''}</p>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: 90 }}>
                      <p style={{ fontWeight: 600, fontSize: '0.85rem' }}>{b.booked_date}</p>
                      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatTime(b.booked_time)}</p>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, background: `${statusColors[b.status]}22`, color: statusColors[b.status], border: `1px solid ${statusColors[b.status]}44` }}>
                      {b.status}
                    </span>
                    <span style={{ fontWeight: 700, color: '#10b981', minWidth: 55, textAlign: 'right' }}>₹{b.fee}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => openEditBooking(b)} title="Edit booking" style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: 'var(--accent-primary)', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', fontWeight: 600 }}>
                        <Pencil size={13}/> Edit
                      </button>
                      <button onClick={() => cancelBooking(b.id)} title="Cancel booking" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', borderRadius: 8, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', fontWeight: 600 }}>
                        <XCircle size={13}/> Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        }
      </div>

      {/* ── Class Type Modal ────────────────────────────────────────────────── */}
      {showTypeModal && (
        <div className="modal-overlay" onClick={() => setShowTypeModal(false)}>
          <div className="glass-panel modal-content" onClick={e => e.stopPropagation()} style={{ padding: 28, maxWidth: 540, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontWeight: 800, fontSize: '1.1rem' }}>{editingTypeId ? 'Edit Class Type' : 'Add New Class Type'}</h3>
              <button onClick={() => setShowTypeModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20}/></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Class Name *</label>
                <input className="form-input" style={{ width: '100%' }} placeholder="e.g. Yoga, Guitar, Drawing" value={editingType.name || ''} onChange={e => setEditingType(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Description</label>
                <input className="form-input" style={{ width: '100%' }} placeholder="Short description shown on the card" value={editingType.description || ''} onChange={e => setEditingType(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Fee (₹)</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} min={0} value={editingType.fee ?? 500} onChange={e => setEditingType(p => ({ ...p, fee: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Duration (min)</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} min={15} step={15} value={editingType.duration_minutes ?? 60} onChange={e => setEditingType(p => ({ ...p, duration_minutes: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Max per slot</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} min={1} max={20} value={editingType.max_per_slot ?? 4} onChange={e => setEditingType(p => ({ ...p, max_per_slot: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Sort Order</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} min={0} value={editingType.sort_order ?? 0} onChange={e => setEditingType(p => ({ ...p, sort_order: Number(e.target.value) }))} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Icon</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ICON_OPTIONS.map(ic => (
                    <button key={ic} onClick={() => setEditingType(p => ({ ...p, icon: ic }))}
                      style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                        border: `2px solid ${editingType.icon === ic ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                        background: editingType.icon === ic ? 'rgba(99,102,241,0.15)' : 'var(--bg-tertiary)',
                        color: editingType.icon === ic ? 'var(--accent-primary)' : 'var(--text-muted)',
                      }}>
                      {ICON_MAP[ic]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 8 }}>Color</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {COLOR_OPTIONS.map(col => {
                    const c = COLOR_MAP[col];
                    return (
                      <button key={col} onClick={() => setEditingType(p => ({ ...p, color: col }))}
                        style={{ padding: '6px 14px', borderRadius: 20, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, textTransform: 'capitalize',
                          border: `2px solid ${editingType.color === col ? c.border : 'var(--border-color)'}`,
                          background: editingType.color === col ? c.bg : 'var(--bg-tertiary)',
                          color: editingType.color === col ? c.text : 'var(--text-muted)',
                        }}>
                        {col}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="checkbox" id="is_active" checked={editingType.is_active !== false} onChange={e => setEditingType(p => ({ ...p, is_active: e.target.checked }))} style={{ width: 16, height: 16 }} />
                <label htmlFor="is_active" style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>Active (show in booking form)</label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowTypeModal(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveType} disabled={submitting} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {submitting ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }}/> : <Save size={15}/>}
                {editingTypeId ? 'Save Changes' : 'Add Class Type'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Booking Modal ────────────────────────────────────────────── */}
      {showBookingModal && editingBooking && (
        <div className="modal-overlay" onClick={() => setShowBookingModal(false)}>
          <div className="glass-panel modal-content" onClick={e => e.stopPropagation()} style={{ padding: 28, maxWidth: 540, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontWeight: 800, fontSize: '1.1rem' }}>Edit Booking</h3>
              <button onClick={() => setShowBookingModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20}/></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Class Type</label>
                <select className="form-input" style={{ width: '100%' }} value={editingBooking.class_type_id} onChange={e => {
                  const ct = classTypes.find(c => c.id === e.target.value);
                  setEditingBooking((p: any) => ({ ...p, class_type_id: e.target.value, class_type: ct?.name || p.class_type, fee: ct?.fee || p.fee }));
                }}>
                  {classTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Date</label>
                  <input type="date" className="form-input" style={{ width: '100%' }} value={editingBooking.booked_date} onChange={e => setEditingBooking((p: any) => ({ ...p, booked_date: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Time</label>
                  <select className="form-input" style={{ width: '100%' }} value={editingBooking.booked_time} onChange={e => setEditingBooking((p: any) => ({ ...p, booked_time: e.target.value }))}>
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Student Name *</label>
                <input className="form-input" style={{ width: '100%' }} value={editingBooking.student_name} onChange={e => setEditingBooking((p: any) => ({ ...p, student_name: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Phone *</label>
                  <input className="form-input" style={{ width: '100%' }} value={editingBooking.phone_number} onChange={e => setEditingBooking((p: any) => ({ ...p, phone_number: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Fee (₹)</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} value={editingBooking.fee} onChange={e => setEditingBooking((p: any) => ({ ...p, fee: Number(e.target.value) }))} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Email</label>
                <input type="email" className="form-input" style={{ width: '100%' }} placeholder="optional" value={editingBooking.email || ''} onChange={e => setEditingBooking((p: any) => ({ ...p, email: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Notes</label>
                <textarea className="form-input" style={{ width: '100%', resize: 'vertical' }} rows={2} placeholder="optional" value={editingBooking.notes || ''} onChange={e => setEditingBooking((p: any) => ({ ...p, notes: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>Status</label>
                <select className="form-input" style={{ width: '100%' }} value={editingBooking.status} onChange={e => setEditingBooking((p: any) => ({ ...p, status: e.target.value }))}>
                  <option value="upcoming">Upcoming</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowBookingModal(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveBooking} disabled={submitting} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {submitting ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }}/> : <Save size={15}/>}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
