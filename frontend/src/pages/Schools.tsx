import React, { useEffect, useState } from 'react';
import api from '../api';
import {
  School as SchoolIcon, Plus, X, RefreshCw, Copy, Check,
  MapPin, Phone, Mail, Users, Bot, AlertTriangle, Trash2, KeyRound, Settings2, Save
} from 'lucide-react';

interface School {
  id: string;
  name: string;
  slug: string;
  location: string | null;
  contact_phone: string | null;
  website: string | null;
  admin_email: string | null;
  retell_agent_id: string | null;
  status: string;
  contact_count: number;
  created_at: string | null;
}

interface SchoolsProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function Schools({ showToast }: SchoolsProps) {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [adminEmail, setAdminEmail] = useState('');

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
    setName(''); setLocation(''); setContactPhone(''); setWebsite(''); setAdminEmail('');
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

      if (temp_password) {
        setCredentials({ email: school.admin_email, password: temp_password, school: school.name });
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

  const openSettings = async (school: School) => {
    setSettingsSchool(school);
    setSettingsLoading(true);
    try {
      const res = await api.get(`/schools/${school.id}/settings`);
      const raw = res.data || {};
      const form: Record<string, string> = {};
      Object.keys(raw).forEach(k => { form[k] = raw[k] == null ? '' : String(raw[k]); });
      setSettingsForm(form);
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
          <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '18px' }}>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {schools.map(s => (
            <div key={s.id} className="glass-panel" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                    background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <SchoolIcon size={20} style={{ color: 'var(--accent-primary)' }} />
                  </div>
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
                  onClick={() => handleReprovision(s)} title="Re-create/refresh this school's voice agent">
                  <RefreshCw size={14} /> Agent
                </button>
                <button className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  onClick={() => openSettings(s)} title="Configure this school's own calendar, Cal.com, email and caller ID">
                  <Settings2 size={14} /> Settings
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
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '8px' }}>Outbound Caller ID</div>
                  <input className="form-input" style={{ width: '100%' }} placeholder="+91 9876543210 (default: platform number)"
                    value={settingsForm.retell_phone_number || ''} onChange={e => handleSettingsField('retell_phone_number', e.target.value)} />
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '8px' }}>Google Calendar</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <textarea className="form-input" style={{ width: '100%', minHeight: '70px', fontFamily: 'monospace', fontSize: '0.78rem' }}
                      placeholder="Service account credentials JSON (default: platform calendar)"
                      value={settingsForm.google_calendar_credentials_json || ''}
                      onChange={e => handleSettingsField('google_calendar_credentials_json', e.target.value)} />
                    <input className="form-input" style={{ width: '100%' }} placeholder="Calendar ID, e.g. admissions@school.edu.in"
                      value={settingsForm.google_calendar_id || ''} onChange={e => handleSettingsField('google_calendar_id', e.target.value)} />
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '8px' }}>Cal.com (virtual meetings)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input className="form-input" style={{ width: '100%' }} placeholder="Cal.com API key (default: platform account)"
                      value={settingsForm.cal_com_api_key || ''} onChange={e => handleSettingsField('cal_com_api_key', e.target.value)} />
                    <input className="form-input" style={{ width: '100%' }} placeholder="Cal.com event link"
                      value={settingsForm.cal_com_event_link || ''} onChange={e => handleSettingsField('cal_com_event_link', e.target.value)} />
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '8px' }}>Confirmation Email (SMTP)</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: '8px' }}>
                      <input className="form-input" placeholder="SMTP server, e.g. smtp.gmail.com"
                        value={settingsForm.smtp_server || ''} onChange={e => handleSettingsField('smtp_server', e.target.value)} />
                      <input className="form-input" placeholder="Port" value={settingsForm.smtp_port || ''}
                        onChange={e => handleSettingsField('smtp_port', e.target.value)} />
                    </div>
                    <input className="form-input" style={{ width: '100%' }} placeholder="SMTP username"
                      value={settingsForm.smtp_username || ''} onChange={e => handleSettingsField('smtp_username', e.target.value)} />
                    <input className="form-input" style={{ width: '100%' }} type="password" placeholder="SMTP password"
                      value={settingsForm.smtp_password || ''} onChange={e => handleSettingsField('smtp_password', e.target.value)} />
                    <input className="form-input" style={{ width: '100%' }} placeholder="From email, e.g. admissions@school.edu.in"
                      value={settingsForm.smtp_from_email || ''} onChange={e => handleSettingsField('smtp_from_email', e.target.value)} />
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
    </div>
  );
}
