import React, { useEffect, useState, useCallback } from 'react';
import api, { getErrorMessage } from '../api';
import { exportToExcel } from '../utils/exportToExcel';
import {
  BookOpen, Plus, Search, Filter, RefreshCw, Trash2, Edit2, X, Check,
  Award, Calendar, DollarSign, FileSpreadsheet, Tag, GraduationCap
} from 'lucide-react';

export interface Course {
  id: string;
  name: string;
  code: string | null;
  target_grade: string | null;
  stream: string | null;
  fee_structure: string | null;
  duration: string;
  status: 'Active' | 'Upcoming' | 'Archived' | string;
  description: string | null;
  created_at?: string;
}

interface CoursesProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function Courses({ showToast }: CoursesProps) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State
  const [cName, setCName] = useState('');
  const [cCode, setCCode] = useState('');
  const [cTargetGrade, setCTargetGrade] = useState('');
  const [cStream, setCStream] = useState('');
  const [cFeeStructure, setCFeeStructure] = useState('');
  const [cDuration, setCDuration] = useState('1 Year');
  const [cStatus, setCStatus] = useState('Active');
  const [cDescription, setCDescription] = useState('');

  const fetchCourses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/courses', {
        params: { search, status: statusFilter }
      });
      setCourses(res.data || []);
    } catch (err) {
      console.error('Failed to fetch courses:', err);
      showToast(getErrorMessage(err, 'Failed to load academic programs'), 'error');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, showToast]);

  useEffect(() => {
    fetchCourses();
  }, [fetchCourses]);

  const openCreateModal = () => {
    setEditingCourse(null);
    setCName('');
    setCCode('');
    setCTargetGrade('');
    setCStream('');
    setCFeeStructure('');
    setCDuration('1 Year');
    setCStatus('Active');
    setCDescription('');
    setShowModal(true);
  };

  const openEditModal = (c: Course) => {
    setEditingCourse(c);
    setCName(c.name);
    setCCode(c.code || '');
    setCTargetGrade(c.target_grade || '');
    setCStream(c.stream || '');
    setCFeeStructure(c.fee_structure || '');
    setCDuration(c.duration || '1 Year');
    setCStatus(c.status || 'Active');
    setCDescription(c.description || '');
    setShowModal(true);
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cName.trim()) {
      showToast('Course name is required', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: cName.trim(),
        code: cCode.trim() || null,
        target_grade: cTargetGrade.trim() || null,
        stream: cStream.trim() || null,
        fee_structure: cFeeStructure.trim() || null,
        duration: cDuration.trim() || '1 Year',
        status: cStatus,
        description: cDescription.trim() || null,
      };

      if (editingCourse) {
        await api.put(`/courses/${editingCourse.id}`, payload);
        showToast('Academic program updated successfully', 'success');
      } else {
        await api.post('/courses', payload);
        showToast('New academic program created', 'success');
      }

      setShowModal(false);
      fetchCourses();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save course'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCourse = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;
    try {
      await api.delete(`/courses/${id}`);
      showToast(`Deleted "${name}"`, 'success');
      fetchCourses();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to delete course'), 'error');
    }
  };

  const handleExportExcel = () => {
    exportToExcel(
      courses,
      [
        { header: 'Program Name', key: 'name' },
        { header: 'Code', key: (c) => c.code || '' },
        { header: 'Target Grade', key: (c) => c.target_grade || '' },
        { header: 'Stream / Department', key: (c) => c.stream || '' },
        { header: 'Annual Fee Structure', key: (c) => c.fee_structure || '' },
        { header: 'Duration', key: 'duration' },
        { header: 'Admissions Status', key: 'status' },
        { header: 'Highlights / Description', key: (c) => c.description || '' }
      ],
      'Academic_Programs_Report'
    );
  };

  const totalPrograms = courses.length;
  const activePrograms = courses.filter(c => c.status === 'Active').length;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <GraduationCap style={{ color: 'var(--accent-primary)' }} size={32} />
            Academic Courses & Programs
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
            Manage curriculum streams, grade offerings, fee structures, and admissions availability
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            className="btn btn-secondary"
            onClick={handleExportExcel}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', fontWeight: 600, fontSize: '0.9rem', background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}
          >
            <FileSpreadsheet size={18} />
            Export to Excel
          </button>
          
          <button
            className="btn btn-primary"
            onClick={openCreateModal}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 18px', fontWeight: 600, fontSize: '0.9rem' }}
          >
            <Plus size={18} />
            Add Program
          </button>
        </div>
      </div>

      {/* Summary Stats Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '16px', marginBottom: '28px' }}>
        <div className="glass-panel" style={{ padding: '18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div className="icon-badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-primary)' }}>
            <BookOpen size={20} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{totalPrograms}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Total Programs</div>
          </div>
        </div>

        <div className="glass-panel" style={{ padding: '18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div className="icon-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
            <Check size={20} />
          </div>
          <div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{activePrograms}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Active Admissions</div>
          </div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="glass-panel" style={{ display: 'flex', gap: '12px', marginBottom: '24px', padding: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flexGrow: 1, minWidth: '240px', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.2)', padding: '8px 16px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <Search size={18} style={{ color: 'var(--text-secondary)' }} />
          <input
            type="text"
            placeholder="Search programs by name, code, or grade..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ background: 'none', border: 'none', color: 'var(--text-primary)', outline: 'none', width: '100%', fontSize: '0.95rem' }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="form-input"
          style={{ width: '160px' }}
        >
          <option value="">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Upcoming">Upcoming</option>
          <option value="Archived">Archived</option>
        </select>
      </div>

      {/* Courses Cards Grid */}
      {loading ? (
        <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <RefreshCw className="spin" style={{ animation: 'spin 2s linear infinite' }} size={24} />
          <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Loading academic programs...</p>
        </div>
      ) : courses.length === 0 ? (
        <div className="glass-panel" style={{ padding: '60px', textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <BookOpen size={48} style={{ opacity: 0.3, marginBottom: '12px' }} />
          <h3>No Courses Found</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>Click "Add Program" to create a new curriculum stream.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '20px' }}>
          {courses.map((c) => (
            <div key={c.id} className="glass-panel hover-lift" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, paddingRight: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                      {c.name}
                    </h3>
                    {c.code && (
                      <span style={{ fontSize: '0.72rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-primary)', fontWeight: 700 }}>
                        {c.code}
                      </span>
                    )}
                  </div>
                  {c.stream && (
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      {c.stream}
                    </span>
                  )}
                </div>

                <span style={{
                  fontSize: '0.75rem', padding: '3px 10px', borderRadius: '12px', fontWeight: 700, whiteSpace: 'nowrap',
                  background: c.status === 'Active' ? 'rgba(16, 185, 129, 0.15)' : c.status === 'Upcoming' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                  color: c.status === 'Active' ? '#10b981' : c.status === 'Upcoming' ? '#f59e0b' : 'var(--text-muted)',
                  border: `1px solid ${c.status === 'Active' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(148, 163, 184, 0.3)'}`
                }}>
                  {c.status}
                </span>
              </div>

              {/* Details Pills */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', background: 'var(--bg-tertiary)', padding: '12px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Target Grade</span>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{c.target_grade || 'All Grades'}</strong>
                </div>
                <div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Duration</span>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{c.duration}</strong>
                </div>
                {c.fee_structure && (
                  <div style={{ gridColumn: 'span 2', borderTop: '1px solid var(--border-color)', paddingTop: '8px', marginTop: '2px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Annual Fee Structure</span>
                    <strong style={{ fontSize: '0.9rem', color: '#10b981' }}>{c.fee_structure}</strong>
                  </div>
                )}
              </div>

              {/* Description */}
              {c.description && (
                <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: '1.45', margin: 0 }}>
                  {c.description}
                </p>
              )}

              {/* Actions Footer */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: 'auto', borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => openEditModal(c)}
                  style={{ fontSize: '0.8rem', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Edit2 size={14} /> Edit
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => handleDeleteCourse(c.id, c.name)}
                  style={{ fontSize: '0.8rem', padding: '6px 12px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="glass-panel modal-content" onClick={(e) => e.stopPropagation()} style={{ padding: '26px', maxWidth: '580px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '4px' }}>
                  {editingCourse ? 'Edit Academic Program' : 'Create Academic Program'}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Configure course stream, eligibility, fees, and status</p>
              </div>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveCourse} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                  Program / Course Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. IB Diploma Program (DP)"
                  value={cName}
                  onChange={(e) => setCName(e.target.value)}
                  className="form-input"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                    Course Code
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. IB-DP, CBSE-SCI"
                    value={cCode}
                    onChange={(e) => setCCode(e.target.value)}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                    Target Grade / Age
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Grade 11 - 12"
                    value={cTargetGrade}
                    onChange={(e) => setCTargetGrade(e.target.value)}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                    Stream / Curriculum
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Science, International"
                    value={cStream}
                    onChange={(e) => setCStream(e.target.value)}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                    Duration
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 2 Years, 1 Year"
                    value={cDuration}
                    onChange={(e) => setCDuration(e.target.value)}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                    Annual Fee Structure
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. ₹ 3,50,000 / annum"
                    value={cFeeStructure}
                    onChange={(e) => setCFeeStructure(e.target.value)}
                    className="form-input"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                    Admissions Status
                  </label>
                  <select
                    value={cStatus}
                    onChange={(e) => setCStatus(e.target.value)}
                    className="form-input"
                    style={{ width: '100%' }}
                  >
                    <option value="Active">Active Admissions</option>
                    <option value="Upcoming">Upcoming</option>
                    <option value="Archived">Archived</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="form-label" style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '6px', display: 'block' }}>
                  Program Highlights / Syllabus Overview
                </label>
                <textarea
                  rows={3}
                  placeholder="Key subjects, entrance test prep, degree recognition, extra-curricular highlights..."
                  value={cDescription}
                  onChange={(e) => setCDescription(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '10px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? <RefreshCw className="spin" style={{ animation: 'spin 2s linear infinite' }} size={16} /> : <Check size={16} />}
                  {saving ? 'Saving...' : editingCourse ? 'Save Changes' : 'Create Program'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
