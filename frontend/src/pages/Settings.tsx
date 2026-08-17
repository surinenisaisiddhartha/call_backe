import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import Schools from './Schools';
import {
  School as SchoolIcon,
  Plug,
  Palette,
  CalendarRange,
  Mail,
  RefreshCw,
  Search,
  BookOpen,
  CheckCircle2,
  Save,
  Sliders,
  Shield,
  ArrowLeft,
  Sun,
  Moon,
  Sparkles
} from 'lucide-react';

interface SettingsProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  currentTheme?: string;
  onThemeChange?: (theme: string) => void;
  initialTab?: 'schools' | 'integrations' | 'appearance';
}

export default function Settings({
  showToast,
  currentTheme = 'light',
  onThemeChange,
  initialTab = 'schools'
}: SettingsProps) {
  const [activeTab, setActiveTab] = useState<'schools' | 'integrations' | 'appearance'>(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Knowledge Base state
  const [kbStatus, setKbStatus] = useState<{ total_chunks: number; last_scraped: string | null; urls_monitored: number } | null>(null);
  const [kbRefreshing, setKbRefreshing] = useState(false);
  const [kbSearchQuery, setKbSearchQuery] = useState('');
  const [kbSearchResult, setKbSearchResult] = useState<string | null>(null);
  const [kbSearching, setKbSearching] = useState(false);

  // Custom Colors
  const [customPrimaryColor, setCustomPrimaryColor] = useState('#6C5CE7');
  const [customSecondaryColor, setCustomSecondaryColor] = useState('#5846E0');

  const [form, setForm] = useState({
    ngrok_auth_token: '',
    ngrok_url: '',
    google_calendar_credentials_json: '',
    google_calendar_id: '',
    concurrency_limit: '1',
    max_retry_attempts: '3',
    retry_backoff_hours: '2',
    smtp_server: '',
    smtp_port: '587',
    smtp_username: '',
    smtp_password: '',
    smtp_from_email: '',
    auto_daily_brief: false,
    daily_brief_time: '08:00',
    super_admin_phone: ''
  });

  const themes = [
    { id: 'light', name: 'Response AI Light', desc: 'Clean white workspace, subtle slate borders, and soft emerald accents', previewColor: '#10B981', bg: '#F8F9FC' },
    { id: 'dark', name: 'Dark Slate Studio', desc: 'Deep obsidian surfaces, glass cards, and electric indigo glow', previewColor: '#6366F1', bg: '#090D16' },
    { id: 'emerald', name: 'Emerald Executive', desc: 'Modern CRM porcelain with vibrant mint & emerald accents', previewColor: '#10B981', bg: '#F8FAFC' },
    { id: 'sapphire', name: 'Sapphire Pro', desc: 'Executive navy blue and high-contrast sapphire accents', previewColor: '#2563EB', bg: '#0B1329' },
    { id: 'amber', name: 'Sunset Amber', desc: 'Warm stone palette with terracotta and amber accents', previewColor: '#EA580C', bg: '#FAF8F5' }
  ];

  useEffect(() => {
    fetchSettings();
    fetchKnowledgeStatus();
  }, []);

  const fetchKnowledgeStatus = async () => {
    try {
      const res = await api.get('/knowledge/status');
      setKbStatus(res.data);
    } catch (err) {
      console.error('Failed to load knowledge base status', err);
    }
  };

  const refreshKnowledgeBase = async () => {
    setKbRefreshing(true);
    setKbSearchResult(null);
    try {
      await api.post('/knowledge/refresh');
      showToast('Knowledge base refresh started in background. It may take 30-60 seconds.', 'success');
      setTimeout(async () => {
        await fetchKnowledgeStatus();
        setKbRefreshing(false);
      }, 8000);
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to trigger knowledge base refresh'), 'error');
      setKbRefreshing(false);
    }
  };

  const searchKnowledgeBase = async () => {
    if (!kbSearchQuery.trim() || kbSearchQuery.trim().length < 3) {
      showToast('Please enter at least 3 characters to search', 'error');
      return;
    }
    setKbSearching(true);
    setKbSearchResult(null);
    try {
      const res = await api.get('/knowledge/search', { params: { query: kbSearchQuery } });
      setKbSearchResult(res.data.answer || 'No results found.');
    } catch (err) {
      showToast(getErrorMessage(err, 'Knowledge base search failed'), 'error');
    } finally {
      setKbSearching(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings');
      setForm(prev => ({ ...prev, ...res.data }));
      setLoading(false);
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to load settings'), 'error');
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setForm(prev => ({ ...prev, [name]: checked }));
    } else {
      setForm(prev => ({ ...prev, [name]: value }));
    }
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/settings', form);
      showToast('System settings saved successfully!', 'success');
      fetchSettings();
    } catch (err) {
      showToast('Failed to save system settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleApplyTheme = (themeId: string) => {
    if (onThemeChange) {
      onThemeChange(themeId);
    } else {
      localStorage.setItem('theme', themeId);
      document.documentElement.setAttribute('data-theme', themeId);
    }
    showToast(`Applied ${themeId} theme`, 'success');
  };

  const handleApplyCustomColor = () => {
    document.documentElement.style.setProperty('--accent-primary', customPrimaryColor);
    document.documentElement.style.setProperty('--accent-secondary', customSecondaryColor);
    showToast('Applied custom brand accent colors', 'success');
  };

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Top Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : (window.location.hash = '#dashboard')}
            className="btn btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px' }}
          >
            <ArrowLeft size={14} /> Back
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>/</span>
          <span style={{ color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600 }}>Organization & System</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: 800, margin: 0 }}>
              Organization & System
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px', marginBottom: 0 }}>
              Manage school campuses, integrations (Calendar, SMTP, Webhooks), and interface branding
            </p>
          </div>

          {/* Navigation Pill Switcher */}
          <div style={{
            display: 'inline-flex',
            background: 'var(--bg-secondary)',
            padding: '4px',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            gap: '4px'
          }}>
            <button
              type="button"
              onClick={() => setActiveTab('schools')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'schools' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'schools' ? '#fff' : 'var(--text-secondary)',
                fontWeight: activeTab === 'schools' ? 700 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <SchoolIcon size={16} />
              Schools & Campuses
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('integrations')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'integrations' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'integrations' ? '#fff' : 'var(--text-secondary)',
                fontWeight: activeTab === 'integrations' ? 700 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <Plug size={16} />
              Integrations & System
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('appearance')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: 'none',
                background: activeTab === 'appearance' ? 'var(--accent-primary)' : 'transparent',
                color: activeTab === 'appearance' ? '#fff' : 'var(--text-secondary)',
                fontWeight: activeTab === 'appearance' ? 700 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              <Palette size={16} />
              Appearance & Themes
            </button>
          </div>
        </div>
      </div>

      {/* ── TAB 1: SCHOOLS & CAMPUSES ──────────────────────────────────────── */}
      {activeTab === 'schools' && (
        <div>
          <Schools showToast={showToast} />
        </div>
      )}

      {/* ── TAB 2: INTEGRATIONS & SYSTEM ──────────────────────────────────── */}
      {activeTab === 'integrations' && (
        <form onSubmit={saveSettings} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
          {/* Left Column: Calendar & Webhook Tunnel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Google Calendar */}
            <div className="card" style={{ padding: '24px', borderRadius: '16px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <CalendarRange size={18} style={{ color: 'var(--accent-primary)' }} />
                Google Calendar Integration
              </h3>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label">Google Service Account Credentials (JSON)</label>
                <textarea
                  name="google_calendar_credentials_json"
                  className="input-field"
                  rows={4}
                  value={form.google_calendar_credentials_json || ''}
                  onChange={handleInputChange}
                  placeholder="Paste your Google Cloud Service Account JSON key"
                  style={{ fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', width: '100%' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label className="form-label">Google Calendar ID</label>
                <input
                  type="text"
                  name="google_calendar_id"
                  className="input-field"
                  value={form.google_calendar_id || ''}
                  onChange={handleInputChange}
                  placeholder="primary or school-calendar@group.calendar.google.com"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '10px', padding: '14px', fontSize: '0.82rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '6px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sparkles size={14} /> Quick Calendar Checklist
                </div>
                <ol style={{ margin: 0, paddingLeft: '16px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  <li>Create a Google Service Account in GCP Console and enable Calendar API.</li>
                  <li>Download the key JSON and paste above.</li>
                  <li>Share your target Google Calendar with the service account email (with "Make changes" permission).</li>
                </ol>
              </div>
            </div>

            {/* Ngrok Public Webhook Tunnel */}
            <div className="card" style={{ padding: '24px', borderRadius: '16px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <RefreshCw size={18} style={{ color: 'var(--accent-success)' }} />
                Ngrok Webhook Tunnel
              </h3>

              <div className="form-group" style={{ marginBottom: '14px' }}>
                <label className="form-label">Ngrok Auth Token</label>
                <input
                  type="password"
                  name="ngrok_auth_token"
                  className="input-field"
                  value={form.ngrok_auth_token || ''}
                  onChange={handleInputChange}
                  placeholder="Enter your ngrok auth token"
                  style={{ width: '100%' }}
                />
              </div>

              {form.ngrok_url && (
                <div className="form-group">
                  <label className="form-label">Active Tunnel Webhook URL</label>
                  <input
                    type="text"
                    name="ngrok_url"
                    className="input-field"
                    value={`${form.ngrok_url}/api/webhooks/retell`}
                    disabled
                    style={{ opacity: 0.85, color: 'var(--accent-success)', borderColor: 'var(--accent-success)', width: '100%' }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Right Column: SMTP & System Limits */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* SMTP Email Configuration */}
            <div className="card" style={{ padding: '24px', borderRadius: '16px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <Mail size={18} style={{ color: 'var(--accent-secondary)' }} />
                SMTP Email Notifications
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label className="form-label">SMTP Server</label>
                  <input
                    type="text"
                    name="smtp_server"
                    className="input-field"
                    value={form.smtp_server || ''}
                    onChange={handleInputChange}
                    placeholder="smtp.gmail.com"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label">Port</label>
                  <input
                    type="text"
                    name="smtp_port"
                    className="input-field"
                    value={form.smtp_port || '587'}
                    onChange={handleInputChange}
                    placeholder="587"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label className="form-label">SMTP Username</label>
                  <input
                    type="text"
                    name="smtp_username"
                    className="input-field"
                    value={form.smtp_username || ''}
                    onChange={handleInputChange}
                    placeholder="admissions@school.edu"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label">SMTP Password</label>
                  <input
                    type="password"
                    name="smtp_password"
                    className="input-field"
                    value={form.smtp_password || ''}
                    onChange={handleInputChange}
                    placeholder="••••••••••••"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Sender Email Address</label>
                <input
                  type="email"
                  name="smtp_from_email"
                  className="input-field"
                  value={form.smtp_from_email || ''}
                  onChange={handleInputChange}
                  placeholder="no-reply@school.edu"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* Platform Limits & Dialer Rules */}
            <div className="card" style={{ padding: '24px', borderRadius: '16px' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                <Sliders size={18} style={{ color: 'var(--accent-primary)' }} />
                Platform & Dialer Parameters
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label className="form-label">Max Concurrency Limit</label>
                  <input
                    type="number"
                    name="concurrency_limit"
                    className="input-field"
                    value={form.concurrency_limit || '1'}
                    onChange={handleInputChange}
                    min="1"
                    max="50"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label">Max Retry Attempts</label>
                  <input
                    type="number"
                    name="max_retry_attempts"
                    className="input-field"
                    value={form.max_retry_attempts || '3'}
                    onChange={handleInputChange}
                    min="1"
                    max="10"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label className="form-label">Retry Backoff (Hours)</label>
                  <input
                    type="number"
                    name="retry_backoff_hours"
                    className="input-field"
                    value={form.retry_backoff_hours || '2'}
                    onChange={handleInputChange}
                    min="1"
                    max="48"
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label">Super Admin Phone</label>
                  <input
                    type="text"
                    name="super_admin_phone"
                    className="input-field"
                    value={form.super_admin_phone || ''}
                    onChange={handleInputChange}
                    placeholder="+91 98765 43210"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <Save size={16} />
                  {saving ? 'Saving...' : 'Save System Settings'}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}

      {/* ── TAB 3: APPEARANCE & THEMES ────────────────────────────────────── */}
      {activeTab === 'appearance' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div className="card" style={{ padding: '24px', borderRadius: '16px' }}>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 16px', color: 'var(--text-primary)' }}>
              Theme Presets
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {themes.map(t => {
                const isSelected = (currentTheme || 'light') === t.id;
                return (
                  <div
                    key={t.id}
                    onClick={() => handleApplyTheme(t.id)}
                    style={{
                      background: 'var(--bg-secondary)',
                      border: isSelected ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                      borderRadius: '14px',
                      padding: '18px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      position: 'relative'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: t.previewColor }} />
                        <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>{t.name}</strong>
                      </div>
                      {isSelected && <CheckCircle2 size={18} color="var(--accent-primary)" />}
                    </div>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                      {t.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card" style={{ padding: '24px', borderRadius: '16px', maxWidth: '640px' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 14px', color: 'var(--text-primary)' }}>
              Custom Brand Accent Overrides
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px', marginBottom: '18px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Primary Accent Color
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="color"
                    value={customPrimaryColor}
                    onChange={(e) => setCustomPrimaryColor(e.target.value)}
                    style={{ width: '40px', height: '40px', borderRadius: '8px', border: 'none', cursor: 'pointer', padding: 0 }}
                  />
                  <input
                    type="text"
                    value={customPrimaryColor}
                    onChange={(e) => setCustomPrimaryColor(e.target.value)}
                    className="input-field"
                    style={{ width: '120px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Secondary Accent Color
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="color"
                    value={customSecondaryColor}
                    onChange={(e) => setCustomSecondaryColor(e.target.value)}
                    style={{ width: '40px', height: '40px', borderRadius: '8px', border: 'none', cursor: 'pointer', padding: 0 }}
                  />
                  <input
                    type="text"
                    value={customSecondaryColor}
                    onChange={(e) => setCustomSecondaryColor(e.target.value)}
                    className="input-field"
                    style={{ width: '120px' }}
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleApplyCustomColor}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Save size={15} /> Apply Brand Accents
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
