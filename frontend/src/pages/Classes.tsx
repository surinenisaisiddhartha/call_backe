import React, { useEffect, useState, useCallback } from 'react';
import api, { getErrorMessage } from '../api';
import { exportToExcel } from '../utils/exportToExcel';
import {
  Music, Palette, Code, Zap, BookOpen, Star, Heart, Globe, Cpu, Mic,
  Calendar, Clock, User, Phone, CheckCircle, XCircle, RefreshCw,
  ChevronLeft, ChevronRight, FileSpreadsheet, Plus, Pencil, Trash2,
  DollarSign, Save, X, ArrowLeft, Mail, FileText, Check, Sparkles,
  ShieldCheck, Search, Filter
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────
interface ClassType {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  fee: number;
  duration_minutes: number;
  max_per_slot: number;
  is_active: boolean;
  sort_order: number;
}

interface SlotInfo {
  time: string;
  booked: number;
  free: number;
  available: boolean;
}

interface DayAvailability {
  date: string;
  label: string;
  total_free: number;
  slots: SlotInfo[];
}

interface Booking {
  id: string;
  class_type_id: string;
  class_type: string;
  booked_date: string;
  booked_time: string;
  student_name: string;
  phone_number: string;
  email: string | null;
  notes: string | null;
  fee: number;
  status: string;
  created_at: string;
}

interface Stats {
  upcoming_classes: number;
  awaiting_payment: number;
  slots_free_today: number;
  booked_value: number;
}

interface ClassesProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

// ── Icon map ───────────────────────────────────────────────────────────────
const ICON_MAP: Record<string, React.ReactNode> = {
  music: <Music size={20} />,
  dance: <Zap size={20} />,
  art: <Palette size={20} />,
  coding: <Code size={20} />,
  book: <BookOpen size={20} />,
  star: <Star size={20} />,
  heart: <Heart size={20} />,
  globe: <Globe size={20} />,
  cpu: <Cpu size={20} />,
  mic: <Mic size={20} />,
};
const ICON_OPTIONS = ['music', 'dance', 'art', 'coding', 'book', 'star', 'heart', 'globe', 'cpu', 'mic'];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; gradient: string; glow: string }> = {
  indigo: {
    bg: 'rgba(99, 102, 241, 0.08)',
    border: 'rgba(99, 102, 241, 0.4)',
    text: '#818cf8',
    gradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    glow: 'rgba(99, 102, 241, 0.25)'
  },
  pink: {
    bg: 'rgba(244, 63, 94, 0.08)',
    border: 'rgba(244, 63, 94, 0.4)',
    text: '#fb7185',
    gradient: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
    glow: 'rgba(244, 63, 94, 0.25)'
  },
  amber: {
    bg: 'rgba(245, 158, 11, 0.08)',
    border: 'rgba(245, 158, 11, 0.4)',
    text: '#fbbf24',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    glow: 'rgba(245, 158, 11, 0.25)'
  },
  green: {
    bg: 'rgba(16, 185, 129, 0.08)',
    border: 'rgba(16, 185, 129, 0.4)',
    text: '#34d399',
    gradient: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    glow: 'rgba(16, 185, 129, 0.25)'
  },
  blue: {
    bg: 'rgba(59, 130, 246, 0.08)',
    border: 'rgba(59, 130, 246, 0.4)',
    text: '#60a5fa',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    glow: 'rgba(59, 130, 246, 0.25)'
  },
  purple: {
    bg: 'rgba(168, 85, 247, 0.08)',
    border: 'rgba(168, 85, 247, 0.4)',
    text: '#c084fc',
    gradient: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
    glow: 'rgba(168, 85, 247, 0.25)'
  },
  rose: {
    bg: 'rgba(244, 63, 94, 0.08)',
    border: 'rgba(244, 63, 94, 0.4)',
    text: '#fb7185',
    gradient: 'linear-gradient(135deg, #f43f5e 0%, #be123c 100%)',
    glow: 'rgba(244, 63, 94, 0.25)'
  },
  teal: {
    bg: 'rgba(20, 184, 166, 0.08)',
    border: 'rgba(20, 184, 166, 0.4)',
    text: '#2dd4bf',
    gradient: 'linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)',
    glow: 'rgba(20, 184, 166, 0.25)'
  },
};
const COLOR_OPTIONS = ['indigo', 'pink', 'amber', 'green', 'blue', 'purple', 'rose', 'teal'];

function formatTime(t: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${m.toString().padStart(2, '0')} ${ap}`;
}

const TIME_SLOTS = ['18:00', '19:00', '20:00', '21:00'];

const blankType = (): Partial<ClassType> => ({
  name: '',
  description: '',
  icon: 'book',
  color: 'indigo',
  fee: 500,
  duration_minutes: 60,
  max_per_slot: 4,
  is_active: true,
  sort_order: 0
});

export default function Classes({ showToast }: ClassesProps) {
  const [classTypes, setClassTypes] = useState<ClassType[]>([]);
  const [availability, setAvailability] = useState<DayAvailability[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [stats, setStats] = useState<Stats>({ upcoming_classes: 0, awaiting_payment: 0, slots_free_today: 0, booked_value: 0 });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Booking form selection state (smooth local state, no unmounting)
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [dateOffset, setDateOffset] = useState(0);
  const [studentName, setStudentName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');

  // Search & Filter for Bookings Log
  const [bookingSearch, setBookingSearch] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState('all');

  // Modals
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [editingType, setEditingType] = useState<Partial<ClassType>>(blankType());
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);

  const [showBookingModal, setShowBookingModal] = useState(false);
  const [editingBooking, setEditingBooking] = useState<any>(null);

  const VISIBLE_DAYS = 7;

  // Single fetch on mount or explicit refresh
  const fetchAll = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
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
      
      setSelectedClassId(prev => prev || (types.length > 0 ? types[0].id : ''));
      setSelectedDate(prev => prev || (availRes.data?.length > 0 ? availRes.data[0].date : ''));
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to load classes'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchAll(true);
  }, [fetchAll]);

  // ── Class Type CRUD ───────────────────────────────────────────────────────
  const openAddType = () => {
    setEditingTypeId(null);
    setEditingType(blankType());
    setShowTypeModal(true);
  };
  
  const openEditType = (ct: ClassType) => {
    setEditingTypeId(ct.id);
    setEditingType({ ...ct });
    setShowTypeModal(true);
  };

  const saveType = async () => {
    if (!editingType.name?.trim()) {
      showToast('Class name is required', 'error');
      return;
    }
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
      fetchAll(false);
    } catch (err) {
      showToast(getErrorMessage(err, 'Save failed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const deleteType = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? Existing bookings will remain.`)) return;
    try {
      await api.delete(`/classes/types/${id}`);
      showToast('Class type deleted', 'success');
      fetchAll(false);
    } catch (err) {
      showToast(getErrorMessage(err, 'Delete failed'), 'error');
    }
  };

  // ── Booking submit ────────────────────────────────────────────────────────
  const handleBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassId || !selectedDate || !selectedTime) {
      showToast('Select a class, date and time first', 'error');
      return;
    }
    if (!studentName.trim() || !phone.trim()) {
      showToast('Student name and phone are required', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const ct = classTypes.find(c => c.id === selectedClassId);
      await api.post('/classes/bookings', {
        class_type_id: selectedClassId,
        booked_date: selectedDate,
        booked_time: selectedTime,
        student_name: studentName.trim(),
        phone_number: phone.trim(),
        email: email.trim() || null,
        notes: notes.trim() || null,
        fee: ct?.fee || 500,
      });
      showToast('Class booked successfully! 🎉', 'success');
      setStudentName('');
      setPhone('');
      setEmail('');
      setNotes('');
      setSelectedTime('');
      fetchAll(false);
    } catch (err) {
      showToast(getErrorMessage(err, 'Booking failed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Booking edit/cancel ───────────────────────────────────────────────────
  const openEditBooking = (b: Booking) => {
    setEditingBooking({ ...b });
    setShowBookingModal(true);
  };

  const saveBooking = async () => {
    if (!editingBooking) return;
    setSubmitting(true);
    try {
      await api.put(`/classes/bookings/${editingBooking.id}`, editingBooking);
      showToast('Booking updated ✅', 'success');
      setShowBookingModal(false);
      fetchAll(false);
    } catch (err) {
      showToast(getErrorMessage(err, 'Update failed'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const cancelBooking = async (id: string) => {
    if (!window.confirm('Cancel this booking?')) return;
    try {
      await api.delete(`/classes/bookings/${id}`);
      showToast('Booking cancelled', 'success');
      fetchAll(false);
    } catch (err) {
      showToast(getErrorMessage(err, 'Cancel failed'), 'error');
    }
  };

  const handleExport = () => {
    exportToExcel(
      bookings,
      [
        { header: 'Student Name', key: 'student_name' },
        { header: 'Phone', key: 'phone_number' },
        { header: 'Email', key: (b: Booking) => b.email || '' },
        { header: 'Class', key: 'class_type' },
        { header: 'Date', key: 'booked_date' },
        { header: 'Time', key: 'booked_time' },
        { header: 'Fee (₹)', key: (b: Booking) => String(b.fee) },
        { header: 'Status', key: 'status' },
        { header: 'Notes', key: (b: Booking) => b.notes || '' },
      ],
      'Class_Bookings'
    );
  };

  const visibleDays = availability.slice(dateOffset, dateOffset + VISIBLE_DAYS);
  const selectedDayData = availability.find(d => d.date === selectedDate);
  const selectedSlots = selectedDayData?.slots || [];
  const selectedClass = classTypes.find(c => c.id === selectedClassId);

  // Filtered Bookings for the Log
  const filteredBookings = bookings.filter(b => {
    if (bookingStatusFilter !== 'all' && b.status !== bookingStatusFilter) return false;
    if (bookingSearch.trim()) {
      const q = bookingSearch.toLowerCase();
      const matchName = b.student_name.toLowerCase().includes(q);
      const matchPhone = b.phone_number.includes(q);
      const matchClass = b.class_type.toLowerCase().includes(q);
      if (!matchName && !matchPhone && !matchClass) return false;
    }
    return true;
  });

  if (loading) {
    return (
      <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
        <RefreshCw size={36} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', fontWeight: 600 }}>Loading Academy Classes &amp; Schedules…</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200, margin: '0 auto', paddingBottom: '40px' }}>
      
      {/* ── Top Header & Breadcrumbs ────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <button
              onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.hash = '#dashboard'))}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', fontSize: '0.78rem', borderRadius: '8px' }}
            >
              <ArrowLeft size={13} /> Back
            </button>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>/</span>
            <a href="#dashboard" style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textDecoration: 'none' }}>Dashboard</a>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>/</span>
            <span style={{ color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600 }}>Classes &amp; Batches</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.1rem', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
              Classes &amp; Batches Studio
            </h1>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              borderRadius: '999px',
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              color: 'var(--accent-primary)',
              fontSize: '0.75rem',
              fontWeight: 700
            }}>
              <Sparkles size={13} /> Evening Academy • 6:00 PM – 10:00 PM IST
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginTop: '6px' }}>
            Schedule 1-on-1 and small-group interactive evening classes for prospective students with live payment confirmation.
          </p>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            onClick={() => fetchAll(false)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', padding: '9px 14px' }}
            title="Refresh availability and bookings"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleExport}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)', fontSize: '0.85rem', padding: '9px 16px', fontWeight: 600 }}
          >
            <FileSpreadsheet size={16} /> Export Excel
          </button>
        </div>
      </div>

      {/* ── KPI Stats Cards (Clean Zero-Overlap Grid) ────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 16 }}>
        {[
          {
            label: 'Upcoming Classes',
            value: stats.upcoming_classes,
            sub: 'Active scheduled slots',
            icon: <Calendar size={18} />,
            color: '#3b82f6',
            bg: 'rgba(59, 130, 246, 0.08)',
            border: 'rgba(59, 130, 246, 0.25)',
          },
          {
            label: 'Awaiting Payment',
            value: stats.awaiting_payment,
            sub: 'Pending verification',
            icon: <Clock size={18} />,
            color: '#f59e0b',
            bg: 'rgba(245, 158, 11, 0.08)',
            border: 'rgba(245, 158, 11, 0.25)',
          },
          {
            label: 'Slots Free Today',
            value: stats.slots_free_today,
            sub: 'Evening capacity available',
            icon: <CheckCircle size={18} />,
            color: '#10b981',
            bg: 'rgba(16, 185, 129, 0.08)',
            border: 'rgba(16, 185, 129, 0.25)',
          },
          {
            label: 'Booked Value',
            value: `₹${stats.booked_value.toLocaleString()}`,
            sub: 'Total session revenue',
            icon: <DollarSign size={18} />,
            color: '#6366f1',
            bg: 'rgba(99, 102, 241, 0.08)',
            border: 'rgba(99, 102, 241, 0.25)',
          },
        ].map((s, i) => (
          <div
            key={i}
            className="card hover-lift"
            style={{
              padding: '20px 22px',
              borderRadius: '16px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '14px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.02)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {s.label}
              </span>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: s.bg,
                color: s.color,
                border: `1px solid ${s.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                {s.icon}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '1.95rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--text-primary)', lineHeight: 1 }}>
                {s.value}
              </div>
              <div style={{ fontSize: '0.75rem', color: s.color, fontWeight: 600, marginTop: '8px' }}>
                {s.sub}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Interactive Booking Flow Wizard (Single Unified Container) ──────── */}
      <div className="glass-panel" style={{ padding: '32px', borderRadius: '20px', display: 'flex', flexDirection: 'column', gap: '32px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', boxShadow: '0 10px 30px rgba(0,0,0,0.03)' }}>
        
        {/* ── STEP 1: Select Discipline / Class ────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                Step 1 of 4
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, fontFamily: 'var(--font-display)' }}>
                Select Class Discipline
              </h2>
            </div>
            <button
              onClick={openAddType}
              className="btn btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.82rem',
                padding: '8px 16px',
                background: 'rgba(99, 102, 241, 0.08)',
                color: 'var(--accent-primary)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                fontWeight: 600
              }}
            >
              <Plus size={15} /> Add Custom Class Type
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
            {classTypes.filter(c => c.is_active).map((ct) => {
              const c = COLOR_MAP[ct.color] || COLOR_MAP.indigo;
              const isSel = selectedClassId === ct.id;

              return (
                <div
                  key={ct.id}
                  onClick={() => setSelectedClassId(ct.id)}
                  className="hover-lift"
                  style={{
                    position: 'relative',
                    padding: '20px',
                    borderRadius: '16px',
                    border: `2px solid ${isSel ? c.border : 'var(--border-color)'}`,
                    background: isSel ? c.bg : 'var(--bg-tertiary)',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                    boxShadow: isSel ? `0 12px 28px -6px ${c.glow}` : 'none'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '12px',
                      background: isSel ? c.gradient : 'var(--bg-secondary)',
                      color: isSel ? '#ffffff' : c.text,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: `1px solid ${isSel ? 'transparent' : 'var(--border-color)'}`,
                      boxShadow: isSel ? `0 6px 16px -2px ${c.glow}` : 'none'
                    }}>
                      {ICON_MAP[ct.icon] || <BookOpen size={20} />}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {isSel && (
                        <div style={{
                          background: c.text,
                          color: '#ffffff',
                          borderRadius: '50%',
                          width: '22px',
                          height: '22px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <Check size={14} strokeWidth={3} />
                        </div>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); openEditType(ct); }}
                        title="Edit Class"
                        style={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          padding: '4px 6px',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteType(ct.id, ct.name); }}
                        title="Delete Class"
                        style={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          padding: '4px 6px',
                          cursor: 'pointer',
                          color: '#ef4444',
                          display: 'flex',
                          alignItems: 'center'
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px', fontFamily: 'var(--font-display)' }}>
                    {ct.name}
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.45, minHeight: '36px', margin: '0 0 14px 0' }}>
                    {ct.description}
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: c.text }}>
                      ₹{ct.fee}
                    </span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '3px 8px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                      ⏱️ {ct.duration_minutes} min
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── STEP 2: Pick a Date Carousel ──────────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                Step 2 of 4
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Calendar size={18} style={{ color: 'var(--accent-primary)' }} /> Select Evening Session Date
              </h2>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Showing next {VISIBLE_DAYS} available days
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setDateOffset(Math.max(0, dateOffset - VISIBLE_DAYS))}
              disabled={dateOffset === 0}
              className="btn btn-secondary btn-icon"
              style={{ width: '42px', height: '42px', borderRadius: '12px', opacity: dateOffset === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronLeft size={18} />
            </button>

            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${VISIBLE_DAYS}, 1fr)`, gap: 10, flex: 1 }}>
              {visibleDays.map((day) => {
                const isSel = selectedDate === day.date;
                const dObj = new Date(day.date);
                const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
                const dayNum = dObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

                return (
                  <button
                    key={day.date}
                    onClick={() => { setSelectedDate(day.date); setSelectedTime(''); }}
                    className="hover-lift"
                    style={{
                      padding: '14px 10px',
                      borderRadius: '14px',
                      textAlign: 'center',
                      border: `2px solid ${isSel ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      background: isSel ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-tertiary)',
                      cursor: day.total_free > 0 ? 'pointer' : 'not-allowed',
                      opacity: day.total_free > 0 ? 1 : 0.45,
                      transition: 'all 0.18s ease',
                      boxShadow: isSel ? '0 8px 20px -4px rgba(99, 102, 241, 0.3)' : 'none'
                    }}
                  >
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: isSel ? 'var(--accent-primary)' : 'var(--text-muted)', letterSpacing: '0.04em' }}>
                      {dayName}
                    </div>
                    <div style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)', margin: '4px 0 2px 0', fontFamily: 'var(--font-display)' }}>
                      {dayNum}
                    </div>
                    <div style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: day.total_free > 0 ? '#10b981' : '#ef4444',
                      background: day.total_free > 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                      padding: '2px 6px',
                      borderRadius: '6px',
                      marginTop: '4px',
                      display: 'inline-block'
                    }}>
                      {day.total_free > 0 ? `${day.total_free} Free` : 'Full'}
                    </div>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setDateOffset(Math.min(availability.length - VISIBLE_DAYS, dateOffset + VISIBLE_DAYS))}
              disabled={dateOffset + VISIBLE_DAYS >= availability.length}
              className="btn btn-secondary btn-icon"
              style={{ width: '42px', height: '42px', borderRadius: '12px', opacity: dateOffset + VISIBLE_DAYS >= availability.length ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* ── STEP 3: Pick an Evening Time Slot ────────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
              Step 3 of 4
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} style={{ color: 'var(--accent-primary)' }} /> Select 1-Hour Evening Time Slot
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {selectedSlots.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', gridColumn: '1 / -1' }}>
                Please choose an available date in Step 2 to view slots.
              </p>
            ) : (
              selectedSlots.map((slot) => {
                const isSel = selectedTime === slot.time;
                return (
                  <button
                    key={slot.time}
                    onClick={() => slot.available && setSelectedTime(slot.time)}
                    className="hover-lift"
                    style={{
                      padding: '16px',
                      borderRadius: '14px',
                      textAlign: 'left',
                      border: `2px solid ${isSel ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      background: isSel ? 'rgba(99, 102, 241, 0.12)' : slot.available ? 'var(--bg-tertiary)' : 'rgba(0,0,0,0.04)',
                      cursor: slot.available ? 'pointer' : 'not-allowed',
                      opacity: slot.available ? 1 : 0.4,
                      transition: 'all 0.18s ease',
                      boxShadow: isSel ? '0 8px 20px -4px rgba(99, 102, 241, 0.25)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '1.05rem', fontWeight: 800, color: isSel ? 'var(--accent-primary)' : 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                        {formatTime(slot.time)}
                      </span>
                      {isSel && (
                        <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'var(--accent-primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '0.74rem', fontWeight: 600, color: slot.available ? 'var(--text-secondary)' : '#ef4444' }}>
                      {slot.available ? `${slot.free} Slots Available` : 'Sold Out'}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── STEP 4: Student Details & Checkout ───────────────────────────── */}
        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '24px' }}>
          <div style={{ marginBottom: '18px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
              Step 4 of 4
            </div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <User size={18} style={{ color: 'var(--accent-primary)' }} /> Student Registration &amp; Instant Booking
            </h2>
          </div>

          <form onSubmit={handleBook}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 6 }}>
                  <User size={14} style={{ color: 'var(--accent-primary)' }} /> Student Full Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. Aarav Sharma"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  style={{ width: '100%', fontSize: '0.9rem', padding: '10px 14px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 6 }}>
                  <Phone size={14} style={{ color: 'var(--accent-primary)' }} /> Parent Phone Number <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="tel"
                  required
                  className="form-input"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ width: '100%', fontSize: '0.9rem', padding: '10px 14px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 6 }}>
                  <Mail size={14} style={{ color: 'var(--accent-primary)' }} /> Email Address (Optional)
                </label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="parent@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ width: '100%', fontSize: '0.9rem', padding: '10px 14px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 6 }}>
                  <FileText size={14} style={{ color: 'var(--accent-primary)' }} /> Special Requirements / Notes
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Beginner level, has acoustic guitar"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ width: '100%', fontSize: '0.9rem', padding: '10px 14px' }}
                />
              </div>
            </div>

            {/* Checkout Confirmation Card */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(16, 185, 129, 0.06) 100%)',
              border: '1px solid var(--accent-primary)',
              borderRadius: '16px',
              padding: '20px 24px',
              flexWrap: 'wrap',
              gap: 16,
              boxShadow: '0 8px 24px -4px rgba(99, 102, 241, 0.15)'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.45rem', fontWeight: 900, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                    ₹{selectedClass?.fee || 500}
                  </span>
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-primary)', background: 'rgba(99, 102, 241, 0.12)', padding: '3px 10px', borderRadius: '6px' }}>
                    {selectedClass?.duration_minutes || 60} Minutes One-to-One
                  </span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {selectedClass && selectedDate && selectedTime ? (
                    <span>
                      🎯 <strong>{selectedClass.name}</strong> on <strong>{selectedDate}</strong> at <strong>{formatTime(selectedTime)}</strong>
                    </span>
                  ) : (
                    'Complete Steps 1, 2, and 3 above to finalize booking.'
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={!selectedClassId || !selectedDate || !selectedTime || submitting}
                className="btn btn-primary hover-lift"
                style={{
                  padding: '13px 28px',
                  borderRadius: '12px',
                  border: 'none',
                  fontWeight: 800,
                  fontSize: '0.95rem',
                  background: selectedClassId && selectedDate && selectedTime ? 'var(--accent-gradient)' : 'rgba(99, 102, 241, 0.25)',
                  color: 'white',
                  cursor: selectedClassId && selectedDate && selectedTime ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  boxShadow: selectedClassId && selectedDate && selectedTime ? '0 10px 24px -4px rgba(16, 185, 129, 0.4)' : 'none',
                  transition: 'all 0.2s ease'
                }}
              >
                {submitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Confirming…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={18} /> Confirm &amp; Book Slot (₹{selectedClass?.fee || 500})
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ── Confirmed Bookings Log (Rich Filterable Table) ────────────────── */}
      <div className="glass-panel" style={{ padding: '26px', borderRadius: '18px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', margin: 0 }}>
              Confirmed Session Bookings Log
            </h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
              {filteredBookings.length} bookings found
            </span>
          </div>

          {/* Search & Filter bar */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-tertiary)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <Search size={14} style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search student or phone..."
                value={bookingSearch}
                onChange={(e) => setBookingSearch(e.target.value)}
                style={{ background: 'none', border: 'none', color: 'var(--text-primary)', outline: 'none', fontSize: '0.82rem', width: '160px' }}
              />
            </div>

            <select
              className="form-input"
              value={bookingStatusFilter}
              onChange={(e) => setBookingStatusFilter(e.target.value)}
              style={{ fontSize: '0.82rem', padding: '6px 10px', width: '130px' }}
            >
              <option value="all">All Statuses</option>
              <option value="upcoming">Upcoming</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {filteredBookings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            <Calendar size={36} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
            <h4 style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>No matching bookings found</h4>
            <p style={{ fontSize: '0.82rem', marginTop: 4 }}>Try changing your search term or booking a class above.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filteredBookings.map((b) => {
              const ct = classTypes.find(c => c.id === b.class_type_id);
              const c = COLOR_MAP[ct?.color || 'indigo'] || COLOR_MAP.indigo;
              const statusColors: Record<string, string> = { upcoming: '#10b981', completed: '#3b82f6', cancelled: '#ef4444' };

              return (
                <div
                  key={b.id}
                  className="hover-lift"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    background: 'var(--bg-tertiary)',
                    borderRadius: '12px',
                    padding: '14px 18px',
                    border: '1px solid var(--border-color)',
                    flexWrap: 'wrap'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '0.78rem',
                      fontWeight: 800,
                      background: c.bg,
                      color: c.text,
                      border: `1px solid ${c.border}`,
                      whiteSpace: 'nowrap',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      {ICON_MAP[ct?.icon || 'book']} {b.class_type}
                    </span>
                    <div>
                      <h4 style={{ fontWeight: 800, fontSize: '0.94rem', color: 'var(--text-primary)', margin: 0 }}>
                        {b.student_name}
                      </h4>
                      <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                        {b.phone_number} {b.email && `• ${b.email}`}
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                        📅 {b.booked_date}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        ⏰ {formatTime(b.booked_time)}
                      </div>
                    </div>

                    <span style={{
                      padding: '3px 9px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      background: `${statusColors[b.status]}18`,
                      color: statusColors[b.status],
                      border: `1px solid ${statusColors[b.status]}35`
                    }}>
                      {b.status.toUpperCase()}
                    </span>

                    <span style={{ fontWeight: 800, color: '#10b981', fontSize: '0.95rem', minWidth: '55px', textAlign: 'right' }}>
                      ₹{b.fee}
                    </span>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => openEditBooking(b)}
                        title="Edit booking"
                        style={{
                          background: 'rgba(99, 102, 241, 0.08)',
                          border: '1px solid rgba(99, 102, 241, 0.25)',
                          color: 'var(--accent-primary)',
                          borderRadius: 8,
                          padding: '5px 10px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: '0.75rem',
                          fontWeight: 700
                        }}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        onClick={() => cancelBooking(b.id)}
                        title="Cancel booking"
                        style={{
                          background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          color: '#ef4444',
                          borderRadius: 8,
                          padding: '5px 10px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: '0.75rem',
                          fontWeight: 700
                        }}
                      >
                        <XCircle size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Class Type Modal ────────────────────────────────────────────────── */}
      {showTypeModal && (
        <div className="modal-overlay" onClick={() => setShowTypeModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: 28, maxWidth: 540, width: '100%', borderRadius: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid var(--border-color)', paddingBottom: 14 }}>
              <h3 style={{ fontWeight: 800, fontSize: '1.2rem', fontFamily: 'var(--font-display)' }}>
                {editingTypeId ? 'Edit Class Discipline' : 'Add New Class Discipline'}
              </h3>
              <button onClick={() => setShowTypeModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Class Name *</label>
                <input className="form-input" style={{ width: '100%' }} placeholder="e.g. Yoga, Classical Vocal, Robotics" value={editingType.name || ''} onChange={e => setEditingType(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Description</label>
                <input className="form-input" style={{ width: '100%' }} placeholder="Short description shown on the card" value={editingType.description || ''} onChange={e => setEditingType(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Fee (₹)</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} min={0} value={editingType.fee ?? 500} onChange={e => setEditingType(p => ({ ...p, fee: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Duration (min)</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} min={15} step={15} value={editingType.duration_minutes ?? 60} onChange={e => setEditingType(p => ({ ...p, duration_minutes: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Max per slot</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} min={1} max={20} value={editingType.max_per_slot ?? 4} onChange={e => setEditingType(p => ({ ...p, max_per_slot: Number(e.target.value) }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Sort Order</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} min={0} value={editingType.sort_order ?? 0} onChange={e => setEditingType(p => ({ ...p, sort_order: Number(e.target.value) }))} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 8 }}>Icon</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ICON_OPTIONS.map(ic => (
                    <button
                      key={ic}
                      type="button"
                      onClick={() => setEditingType(p => ({ ...p, icon: ic }))}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        border: `2px solid ${editingType.icon === ic ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                        background: editingType.icon === ic ? 'rgba(99, 102, 241, 0.15)' : 'var(--bg-tertiary)',
                        color: editingType.icon === ic ? 'var(--accent-primary)' : 'var(--text-muted)'
                      }}
                    >
                      {ICON_MAP[ic]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 8 }}>Color Theme</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {COLOR_OPTIONS.map(col => {
                    const c = COLOR_MAP[col];
                    return (
                      <button
                        key={col}
                        type="button"
                        onClick={() => setEditingType(p => ({ ...p, color: col }))}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 20,
                          cursor: 'pointer',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          textTransform: 'capitalize',
                          border: `2px solid ${editingType.color === col ? c.border : 'var(--border-color)'}`,
                          background: editingType.color === col ? c.bg : 'var(--bg-tertiary)',
                          color: editingType.color === col ? c.text : 'var(--text-muted)'
                        }}
                      >
                        {col}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <input
                  type="checkbox"
                  id="is_active"
                  checked={editingType.is_active !== false}
                  onChange={e => setEditingType(p => ({ ...p, is_active: e.target.checked }))}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="is_active" style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  Active in Student Booking Wizard
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button onClick={() => setShowTypeModal(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveType} disabled={submitting} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {submitting ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                {editingTypeId ? 'Save Changes' : 'Add Class Discipline'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Booking Modal ────────────────────────────────────────────── */}
      {showBookingModal && editingBooking && (
        <div className="modal-overlay" onClick={() => setShowBookingModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ padding: 28, maxWidth: 540, width: '100%', borderRadius: '18px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, borderBottom: '1px solid var(--border-color)', paddingBottom: 14 }}>
              <h3 style={{ fontWeight: 800, fontSize: '1.2rem', fontFamily: 'var(--font-display)' }}>Edit Booking</h3>
              <button onClick={() => setShowBookingModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Class Type</label>
                <select
                  className="form-input"
                  style={{ width: '100%' }}
                  value={editingBooking.class_type_id}
                  onChange={e => {
                    const ct = classTypes.find(c => c.id === e.target.value);
                    setEditingBooking((p: any) => ({
                      ...p,
                      class_type_id: e.target.value,
                      class_type: ct?.name || p.class_type,
                      fee: ct?.fee || p.fee
                    }));
                  }}
                >
                  {classTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Date</label>
                  <input type="date" className="form-input" style={{ width: '100%' }} value={editingBooking.booked_date} onChange={e => setEditingBooking((p: any) => ({ ...p, booked_date: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Time</label>
                  <select className="form-input" style={{ width: '100%' }} value={editingBooking.booked_time} onChange={e => setEditingBooking((p: any) => ({ ...p, booked_time: e.target.value }))}>
                    {TIME_SLOTS.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Student Name *</label>
                <input className="form-input" style={{ width: '100%' }} value={editingBooking.student_name} onChange={e => setEditingBooking((p: any) => ({ ...p, student_name: e.target.value }))} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Phone *</label>
                  <input className="form-input" style={{ width: '100%' }} value={editingBooking.phone_number} onChange={e => setEditingBooking((p: any) => ({ ...p, phone_number: e.target.value }))} />
                </div>
                <div>
                  <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Fee (₹)</label>
                  <input type="number" className="form-input" style={{ width: '100%' }} value={editingBooking.fee} onChange={e => setEditingBooking((p: any) => ({ ...p, fee: Number(e.target.value) }))} />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Email</label>
                <input type="email" className="form-input" style={{ width: '100%' }} placeholder="optional" value={editingBooking.email || ''} onChange={e => setEditingBooking((p: any) => ({ ...p, email: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Notes</label>
                <textarea className="form-input" style={{ width: '100%', resize: 'vertical' }} rows={2} placeholder="optional" value={editingBooking.notes || ''} onChange={e => setEditingBooking((p: any) => ({ ...p, notes: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 6 }}>Status</label>
                <select className="form-input" style={{ width: '100%' }} value={editingBooking.status} onChange={e => setEditingBooking((p: any) => ({ ...p, status: e.target.value }))}>
                  <option value="upcoming">Upcoming</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
              <button onClick={() => setShowBookingModal(false)} className="btn btn-secondary">Cancel</button>
              <button onClick={saveBooking} disabled={submitting} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {submitting ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
