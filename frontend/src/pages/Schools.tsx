import React, { useEffect, useState } from 'react';
import api from '../api';
import Pagination from '../components/Pagination';
import {
  School as SchoolIcon, Plus, X, RefreshCw, Copy, Check,
  MapPin, Phone, Mail, Users, Bot, AlertTriangle, Trash2, KeyRound, Settings2, Save,
  Pencil, AtSign, Globe
} from 'lucide-react';

interface School {
  id: string;
  name: string;
  slug: string;
  location: string | null;
  contact_phone: string | null;
  website: string | null;
  logo_url: string | null;
  admin_email: string | null;
  retell_agent_id: string | null;
  status: string;
  contact_count: number;
  created_at: string | null;
}

interface EffectiveSetting {
  value: string | null;
  source: 'school' | 'platform' | 'unset';
  secret: boolean;
}

interface SchoolsProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function Schools({ showToast }: SchoolsProps) {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);

  // Credentials are returned exactly once by the API and never stored — the
  // admin must copy them before dismissing this panel.
  const [credentials, setCredentials] = useState<{ email: string; password: string; school: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Per-school settings modal (calendar / Cal.com / SMTP / caller ID) — each
  // field falls back to the shared platform config when left blank, so this
  // only needs to hold what's actually been overridden for this school.
  const [settingsSchool, setSettingsSchool] = useState<School | null>(null);
  const [settingsForm, setSettingsForm] = useState<Record<string, string>>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  // What each setting currently resolves to and where from ("school" override,
  // "platform" default, or "unset") — so a blank edit box doesn't hide whether
  // the setting is configured at all.
  const [effective, setEffective] = useState<Record<string, EffectiveSetting>>({});
  const [bookingProvider, setBookingProvider] = useState<string>('');

  // Edit a school's own identity fields (name/location/phone/website/status).
  const [editSchool, setEditSchool] = useState<School | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [editLogoFile, setEditLogoFile] = useState<File | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Move a school's login to a different email address.
  const [emailSchool, setEmailSchool] = useState<School | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);

  const loadSchools = async () => {
    setLoading(true);
    try {
      const res = await api.get('/schools');
      setSchools(res.data);
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to load schools', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSchools(); }, []);

  const resetForm = () => {
    setName(''); setLocation(''); setContactPhone(''); setWebsite(''); setAdminEmail(''); setLogoFile(null);
  };

  const handleLogoUpload = async (schoolId: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post(`/schools/${schoolId}/logo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.success) {
        setSchools(schools.map(s => s.id === schoolId ? { ...s, logo_url: res.data.logo_url } : s));
        showToast('Logo updated successfully', 'success');
      }
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to upload logo', 'error');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post('/schools', {
        name, location, contact_phone: contactPhone, website, admin_email: adminEmail,
      });
      const { school, temp_password, agent_error, cognito_error } = res.data;

      if (agent_error) {
        showToast(`School created, but its voice agent could not be provisioned: ${agent_error}`, 'error');
      }
      if (cognito_error) {
        showToast(`School created, but no login was created: ${cognito_error}`, 'error');
      }
      if (!agent_error && !cognito_error) {
        showToast(`${school.name} onboarded successfully`, 'success');
      }
      // The knowledge base is scraped in the background from the school's own
      // website. Without a website the agent has nothing to ground answers in,
      // so say so plainly rather than letting it look fully onboarded.
      if (!school.website) {
        showToast(
          `${school.name} has no website set, so its agent has no knowledge base. Add one to build it.`,
          'error'
        );
      }

      if (temp_password) {
        setCredentials({ email: school.admin_email, password: temp_password, school: school.name });
      }

      if (logoFile) {
        await handleLogoUpload(school.id, logoFile);
      }

      resetForm();
      setShowForm(false);
      loadSchools();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to create school', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReprovision = async (school: School) => {
    try {
      await api.post(`/schools/${school.id}/provision-agent`);
      showToast(`Voice agent refreshed for ${school.name}`, 'success');
      loadSchools();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Agent provisioning failed', 'error');
    }
  };

  const handleResetPassword = async (school: School) => {
    if (!window.confirm(`Issue a new temporary password for ${school.name}? Their current password will stop working.`)) return;
    try {
      const res = await api.post(`/schools/${school.id}/reset-password`);
      setCredentials({ email: school.admin_email || '', password: res.data.temp_password, school: school.name });
      showToast('New temporary password generated', 'success');
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Could not reset the password', 'error');
    }
  };

  const handleDelete = async (school: School) => {
    if (!window.confirm(`Remove ${school.name}? This also deletes its login.`)) return;
    try {
      await api.delete(`/schools/${school.id}`);
      showToast(`${school.name} removed`, 'success');
      loadSchools();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Could not remove this school', 'error');
    }
  };

  const SETTINGS_MASK = '••••••••••••••••';

  // Shows what a setting resolves to today and where it came from. This is the
  // bit the override-only form was missing: an empty input box looked identical
  // whether the platform default was filling it in or nothing was set anywhere.
  const EffectiveHint = ({ field }: { field: string }) => {
    const eff = effective[field];
    if (!eff) return null;
    const palette = {
      school: { fg: 'var(--accent-success)', label: 'this school' },
      platform: { fg: 'var(--accent-primary)', label: 'platform default' },
      unset: { fg: 'var(--accent-error)', label: 'not configured' },
    }[eff.source];
    return (
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ color: palette.fg, fontWeight: 700 }}>{palette.label}</span>
        {eff.source !== 'unset' && (
          <span style={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>in use: {eff.value}</span>
        )}
        {eff.source === 'unset' && <span>nothing set here or at platform level</span>}
      </div>
    );
  };

  const SettingField = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <div>
      {children}
      <EffectiveHint field={field} />
    </div>
  );

  const openSettings = async (school: School) => {
    setSettingsSchool(school);
    setSettingsLoading(true);
    try {
      const res = await api.get(`/schools/${school.id}/settings`);
      const overrides = res.data?.overrides || {};
      const form: Record<string, string> = {};
      Object.keys(overrides).forEach(k => { form[k] = overrides[k] == null ? '' : String(overrides[k]); });
      setSettingsForm(form);
      setEffective(res.data?.effective || {});
      setBookingProvider(res.data?.booking_provider || '');
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to load settings', 'error');
      setSettingsSchool(null);
    } finally {
      setSettingsLoading(false);
    }
  };

  const closeSettings = () => {
    setSettingsSchool(null);
    setSettingsForm({});
    setEffective({});
    setBookingProvider('');
  };

  const openEdit = (school: School) => {
    setEditSchool(school);
    setEditLogoFile(null);
    setEditForm({
      name: school.name || '',
      location: school.location || '',
      contact_phone: school.contact_phone || '',
      website: school.website || '',
      status: school.status || 'active',
    });
  };

  const saveEdit = async () => {
    if (!editSchool) return;
    setEditSaving(true);
    try {
      const res = await api.patch(`/schools/${editSchool.id}`, editForm);
      if (editLogoFile) {
        await handleLogoUpload(editSchool.id, editLogoFile);
      }
      showToast(`${editForm.name || editSchool.name} updated`, 'success');
      if (res.data?.agent_error) {
        showToast(`Details saved, but the voice agent could not be updated: ${res.data.agent_error}`, 'error');
      }
      // Changing the website invalidates the scraped knowledge base, so the
      // backend rebuilds it — say so rather than leaving it looking instant.
      if (res.data?.knowledge_refreshing) {
        showToast('Website changed — rebuilding this school’s knowledge base in the background', 'success');
      }
      setEditSchool(null);
      loadSchools();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Could not update this school', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const saveNewEmail = async () => {
    if (!emailSchool) return;
    const target = newEmail.trim().toLowerCase();
    if (!target || !target.includes('@')) {
      showToast('Enter a valid email address', 'error');
      return;
    }
    if (!window.confirm(
      `Move ${emailSchool.name}'s login to ${target}?\n\n` +
      `A new temporary password will be emailed to that address, and the old login ` +
      `(${emailSchool.admin_email || 'none'}) will stop working.`
    )) return;

    setEmailSaving(true);
    try {
      const res = await api.post(`/schools/${emailSchool.id}/change-email`, { admin_email: target });
      if (res.data?.temp_password) {
        setCredentials({ email: res.data.admin_email, password: res.data.temp_password, school: emailSchool.name });
      }
      if (res.data?.warning) showToast(res.data.warning, 'error');
      else showToast(`Login moved to ${target}`, 'success');
      setEmailSchool(null);
      setNewEmail('');
      loadSchools();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Could not change the login email', 'error');
    } finally {
      setEmailSaving(false);
    }
  };

  const handleSettingsField = (field: string, value: string) => {
    setSettingsForm(prev => ({ ...prev, [field]: value }));
  };

  const saveSettings = async () => {
    if (!settingsSchool) return;
    setSettingsSaving(true);
    try {
      await api.patch(`/schools/${settingsSchool.id}/settings`, settingsForm);
      showToast(`Settings saved for ${settingsSchool.name}`, 'success');
      closeSettings();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to save settings', 'error');
    } finally {
      setSettingsSaving(false);
    }
  };

  const copyCredentials = () => {
    if (!credentials) return;
    navigator.clipboard.writeText(`Email: ${credentials.email}\nTemporary password: ${credentials.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800, marginBottom: '4px' }}>Schools</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Onboard a school to give it its own login, its own leads, and its own voice agent.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(v => !v)}>
          {showForm ? <X size={18} /> : <Plus size={18} />}
          {showForm ? 'Cancel' : 'Onboard School'}
        </button>
      </div>

      {/* One-time credentials panel */}
      {credentials && (
        <div className="glass-panel" style={{ padding: '20px', marginBottom: '24px', border: '1px solid var(--accent-success)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', color: 'var(--accent-success)', fontWeight: 700 }}>
                <KeyRound size={18} /> Login for {credentials.school}
              </div>
              <div style={{ fontSize: '0.9rem', marginBottom: '4px' }}>
                <strong>Email:</strong> <code>{credentials.email}</code>
              </div>
              <div style={{ fontSize: '0.9rem' }}>
                <strong>Temporary password:</strong> <code>{credentials.password}</code>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                <AlertTriangle size={14} style={{ color: 'var(--accent-warning, #f59e0b)', flexShrink: 0 }} />
                Shown once and never stored — copy it now. They'll be asked to choose their own password at first login.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button className="btn btn-secondary" onClick={copyCredentials}>
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="btn btn-secondary" onClick={() => setCredentials(null)}><X size={16} /></button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding form */}
      {showForm && (
        <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
          <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '18px' }}>
            <div className="form-group">
              <label className="form-label">School Name *</label>
              <input className="form-input" style={{ width: '100%' }} value={name}
                onChange={e => setName(e.target.value)} placeholder="Delhi Public School" required />
            </div>
            <div className="form-group">
              <label className="form-label">Location</label>
              <input className="form-input" style={{ width: '100%' }} value={location}
                onChange={e => setLocation(e.target.value)} placeholder="Banjara Hills, Hyderabad" />
            </div>
            <div className="form-group">
              <label className="form-label">Admissions Phone</label>
              <input className="form-input" style={{ width: '100%' }} value={contactPhone}
                onChange={e => setContactPhone(e.target.value)} placeholder="+91 9876543210" />
            </div>
            <div className="form-group">
              <label className="form-label">Website</label>
              <input className="form-input" style={{ width: '100%' }} value={website}
                onChange={e => setWebsite(e.target.value)} placeholder="https://school.edu.in" />
            </div>
            <div className="form-group">
              <label className="form-label">School Logo (Optional)</label>
              <input type="file" className="form-input" style={{ width: '100%' }} accept="image/*"
                onChange={e => {
                  if (e.target.files && e.target.files[0]) {
                    setLogoFile(e.target.files[0]);
                  }
                }} />
            </div>
            <div className="form-group">
              <label className="form-label">Login Email *</label>
              <input type="email" className="form-input" style={{ width: '100%' }} value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)} placeholder="admissions@school.edu.in" required />
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                The school signs in with this. A temporary password is generated for you to share.
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={submitting}>
                {submitting ? <RefreshCw size={18} style={{ animation: 'spin 2s linear infinite' }} /> : <Plus size={18} />}
                {submitting ? 'Onboarding…' : 'Create School'}
              </button>
            </div>
          </form>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Bot size={14} style={{ flexShrink: 0 }} />
            A dedicated voice agent is created for this school, speaking its own name, location and phone number.
          </div>
        </div>
      )}

      {/* Schools list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
          <RefreshCw size={24} style={{ animation: 'spin 2s linear infinite' }} />
        </div>
      ) : schools.length === 0 ? (
        <div className="glass-panel" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <SchoolIcon size={40} style={{ color: 'var(--text-muted)', marginBottom: '12px' }} />
          <div style={{ fontWeight: 700, marginBottom: '6px' }}>No schools yet</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Onboard your first school to give it its own dashboard login.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '16px', paddingBottom: '16px' }}>
              {schools.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(s => (
                <div key={s.id} className="glass-panel" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <label style={{ cursor: 'pointer' }} title="Upload School Logo">
                    <input type="file" style={{ display: 'none' }} accept="image/*" onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleLogoUpload(s.id, e.target.files[0]);
                      }
                    }} />
                    <div style={{
                      width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                      background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      overflow: 'hidden', border: '1px solid var(--border-color)', position: 'relative'
                    }}>
                      {s.logo_url ? (
                        <img src={s.logo_url.startsWith('http') ? s.logo_url : `http://localhost:5000${s.logo_url}`} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                      ) : (
                        <SchoolIcon size={20} style={{ color: 'var(--accent-primary)' }} />
                      )}
                      <div className="upload-overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'none', alignItems: 'center', justifyContent: 'center' }}>
                        <Plus size={16} color="#fff" />
                      </div>
                    </div>
                  </label>
                  <style dangerouslySetInnerHTML={{ __html: `label:hover .upload-overlay { display: flex !important; }` }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.slug}</div>
                  </div>
                </div>
                <span style={{
                  padding: '3px 10px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
                  color: s.status === 'active' ? 'var(--accent-success)' : 'var(--text-muted)',
                  background: s.status === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)',
                }}>{s.status}</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {s.location && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><MapPin size={13} /> {s.location}</div>}
                {s.contact_phone && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Phone size={13} /> {s.contact_phone}</div>}
                {s.admin_email && <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <Mail size={13} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.admin_email}</span>
                </div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Users size={13} /> {s.contact_count} leads</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Bot size={13} />
                  {s.retell_agent_id
                    ? <span style={{ color: 'var(--accent-success)' }}>Voice agent ready</span>
                    : <span style={{ color: 'var(--accent-error)' }}>No voice agent</span>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={() => openEdit(s)} title="Edit this school's name, location, phone and website">
                  <Pencil size={14} /> Edit
                </button>
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={() => handleReprovision(s)} title="Re-create/refresh this school's voice agent">
                  <RefreshCw size={14} /> Agent
                </button>
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={() => openSettings(s)} title="See and change this school's Cal.com, calendar, email and caller ID settings">
                  <Settings2 size={14} /> Settings
                </button>
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={() => { setEmailSchool(s); setNewEmail(''); }}
                  title="Move this school's login to a different email address">
                  <AtSign size={14} /> Email
                </button>
                {s.admin_email && (
                  <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                    onClick={() => handleResetPassword(s)} title="Issue a new temporary password">
                    <KeyRound size={14} /> Password
                  </button>
                )}
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px', color: 'var(--accent-error)' }}
                  onClick={() => handleDelete(s)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
            </div>
          </div>
          <Pagination
            currentPage={currentPage}
            totalItems={schools.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {/* Per-school settings modal */}
      {settingsSchool && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }} onClick={(e) => { if (e.target === e.currentTarget) closeSettings(); }}>
          <div className="glass-panel" style={{ maxWidth: '560px', width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Settings2 size={20} /> {settingsSchool.name}
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                  Leave any field blank to use the shared platform default instead.
                </p>
              </div>
              <button className="btn btn-secondary" onClick={closeSettings}><X size={16} /></button>
            </div>

            {settingsLoading ? (
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <RefreshCw size={24} style={{ animation: 'spin 2s linear infinite' }} />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginTop: '18px' }}>
                {bookingProvider && (
                  <div style={{
                    padding: '10px 12px', borderRadius: '10px', fontSize: '0.8rem',
                    background: bookingProvider === 'cal.com' ? 'rgba(16,185,129,0.10)' : 'rgba(245,158,11,0.10)',
                    border: `1px solid ${bookingProvider === 'cal.com' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
                  }}>
                    {bookingProvider === 'cal.com' ? (
                      <>Bookings run through <strong>Cal.com</strong> — it creates the booking, adds the
                      calendar event and emails the attendee. Google Calendar and SMTP below are unused
                      while a Cal.com key is set.</>
                    ) : (
                      <>No Cal.com key is set, so this school falls back to <strong>Google Calendar + SMTP</strong>
                      {' '}for calendar events and confirmation emails.</>
                    )}
                  </div>
                )}

                <SettingField field="retell_phone_number">
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '8px' }}>Outbound Caller ID</div>
                  <input className="form-input" style={{ width: '100%' }} placeholder="+91 9876543210 (default: platform number)"
                    value={settingsForm.retell_phone_number || ''} onChange={e => handleSettingsField('retell_phone_number', e.target.value)} />
                </SettingField>

                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '8px' }}>
                    Cal.com — bookings, calendar &amp; email
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <SettingField field="cal_com_api_key">
                      <input className="form-input" style={{ width: '100%' }} placeholder="Cal.com API key (default: platform account)"
                        value={settingsForm.cal_com_api_key || ''} onChange={e => handleSettingsField('cal_com_api_key', e.target.value)} />
                    </SettingField>
                    <SettingField field="cal_com_event_link">
                      <input className="form-input" style={{ width: '100%' }} placeholder="Cal.com event link"
                        value={settingsForm.cal_com_event_link || ''} onChange={e => handleSettingsField('cal_com_event_link', e.target.value)} />
                    </SettingField>
                    <SettingField field="cal_com_in_person_event_slug">
                      <input className="form-input" style={{ width: '100%' }} placeholder="In-person event slug, e.g. campus-visit"
                        value={settingsForm.cal_com_in_person_event_slug || ''} onChange={e => handleSettingsField('cal_com_in_person_event_slug', e.target.value)} />
                    </SettingField>
                    <SettingField field="cal_com_virtual_event_slug">
                      <input className="form-input" style={{ width: '100%' }} placeholder="Virtual (Cal Video) event slug, e.g. calling"
                        value={settingsForm.cal_com_virtual_event_slug || ''} onChange={e => handleSettingsField('cal_com_virtual_event_slug', e.target.value)} />
                    </SettingField>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Both slugs matter once an account has more than one event type: they decide whether an
                      attendee is emailed a campus address or a video link. If a slug is missing, that
                      meeting kind is not booked at all rather than guessed.
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '4px' }}>Google Calendar</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Fallback only — used when no Cal.com key is configured.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <SettingField field="google_calendar_credentials_json">
                      <textarea className="form-input" style={{ width: '100%', minHeight: '70px', fontFamily: 'monospace', fontSize: '0.78rem' }}
                        placeholder="Service account credentials JSON (default: platform calendar)"
                        value={settingsForm.google_calendar_credentials_json || ''}
                        onChange={e => handleSettingsField('google_calendar_credentials_json', e.target.value)} />
                    </SettingField>
                    <SettingField field="google_calendar_id">
                      <input className="form-input" style={{ width: '100%' }} placeholder="Calendar ID, e.g. admissions@school.edu.in"
                        value={settingsForm.google_calendar_id || ''} onChange={e => handleSettingsField('google_calendar_id', e.target.value)} />
                    </SettingField>
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '4px' }}>Confirmation Email (SMTP)</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Fallback only — Cal.com sends the confirmation when a Cal.com key is configured.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '8px' }}>
                      <SettingField field="smtp_server">
                        <input className="form-input" style={{ width: '100%' }} placeholder="SMTP server, e.g. smtp.gmail.com"
                          value={settingsForm.smtp_server || ''} onChange={e => handleSettingsField('smtp_server', e.target.value)} />
                      </SettingField>
                      <SettingField field="smtp_port">
                        <input className="form-input" style={{ width: '100%' }} placeholder="Port" value={settingsForm.smtp_port || ''}
                          onChange={e => handleSettingsField('smtp_port', e.target.value)} />
                      </SettingField>
                    </div>
                    <SettingField field="smtp_username">
                      <input className="form-input" style={{ width: '100%' }} placeholder="SMTP username"
                        value={settingsForm.smtp_username || ''} onChange={e => handleSettingsField('smtp_username', e.target.value)} />
                    </SettingField>
                    <SettingField field="smtp_password">
                      <input className="form-input" style={{ width: '100%' }} type="password" placeholder="SMTP password"
                        value={settingsForm.smtp_password || ''} onChange={e => handleSettingsField('smtp_password', e.target.value)} />
                    </SettingField>
                    <SettingField field="smtp_from_email">
                      <input className="form-input" style={{ width: '100%' }} placeholder="From email, e.g. admissions@school.edu.in"
                        value={settingsForm.smtp_from_email || ''} onChange={e => handleSettingsField('smtp_from_email', e.target.value)} />
                    </SettingField>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <button className="btn btn-secondary" onClick={closeSettings}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveSettings} disabled={settingsSaving}>
                    {settingsSaving ? <RefreshCw size={16} style={{ animation: 'spin 2s linear infinite' }} /> : <Save size={16} />}
                    {settingsSaving ? 'Saving…' : 'Save Settings'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit a school's own identity fields */}
      {editSchool && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }} onClick={(e) => { if (e.target === e.currentTarget) setEditSchool(null); }}>
          <div className="glass-panel" style={{ maxWidth: '480px', width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Pencil size={18} /> Edit {editSchool.name}
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                  Changing the name, location or phone re-renders this school's voice agent prompt.
                  Changing the website rebuilds its knowledge base.
                </p>
              </div>
              <button className="btn btn-secondary" onClick={() => setEditSchool(null)}><X size={16} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '18px' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>School name</div>
                <input className="form-input" style={{ width: '100%' }} value={editForm.name || ''}
                  onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>Location</div>
                <input className="form-input" style={{ width: '100%' }} placeholder="e.g. Gachibowli, Hyderabad"
                  value={editForm.location || ''} onChange={e => setEditForm(p => ({ ...p, location: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>Contact phone</div>
                <input className="form-input" style={{ width: '100%' }} placeholder="+91 7569891111"
                  value={editForm.contact_phone || ''} onChange={e => setEditForm(p => ({ ...p, contact_phone: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Globe size={14} /> Website
                </div>
                <input className="form-input" style={{ width: '100%' }} placeholder="https://school.edu.in"
                  value={editForm.website || ''} onChange={e => setEditForm(p => ({ ...p, website: e.target.value }))} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>Status</div>
                <select className="form-input" style={{ width: '100%' }} value={editForm.status || 'active'}
                  onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>School Logo</div>
                <input type="file" className="form-input" style={{ width: '100%' }} accept="image/*"
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      setEditLogoFile(e.target.files[0]);
                    }
                  }} />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Select an image to change the logo.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button className="btn btn-secondary" onClick={() => setEditSchool(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveEdit} disabled={editSaving}>
                  {editSaving ? <RefreshCw size={16} style={{ animation: 'spin 2s linear infinite' }} /> : <Save size={16} />}
                  {editSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Move a school's login to a different email */}
      {emailSchool && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
        }} onClick={(e) => { if (e.target === e.currentTarget) setEmailSchool(null); }}>
          <div className="glass-panel" style={{ maxWidth: '460px', width: '100%', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AtSign size={18} /> Change login email
              </h2>
              <button className="btn btn-secondary" onClick={() => setEmailSchool(null)}><X size={16} /></button>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '8px' }}>
              {emailSchool.name} currently signs in as{' '}
              <strong>{emailSchool.admin_email || 'no login yet'}</strong>.
            </p>

            <div style={{
              marginTop: '12px', padding: '10px 12px', borderRadius: '10px', fontSize: '0.78rem',
              background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)',
            }}>
              A brand-new login is created for the new address and a temporary password is emailed to it.
              The old login is then removed and stops working immediately.
            </div>

            <div style={{ marginTop: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>New login email</div>
              <input className="form-input" style={{ width: '100%' }} type="email" placeholder="admissions@school.edu.in"
                value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '18px' }}>
              <button className="btn btn-secondary" onClick={() => setEmailSchool(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveNewEmail} disabled={emailSaving}>
                {emailSaving ? <RefreshCw size={16} style={{ animation: 'spin 2s linear infinite' }} /> : <AtSign size={16} />}
                {emailSaving ? 'Moving…' : 'Move Login'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
