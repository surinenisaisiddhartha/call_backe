import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import { Calendar, CalendarRange, Shield, Cpu, RefreshCw, CheckCircle, HelpCircle, Mail, Database, Search, BookOpen, AlertTriangle } from 'lucide-react';

interface SettingsProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function Settings({ showToast }: SettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Knowledge Base state
  const [kbStatus, setKbStatus] = useState<{ total_chunks: number; last_scraped: string | null; urls_monitored: number } | null>(null);
  const [kbRefreshing, setKbRefreshing] = useState(false);
  const [kbSearchQuery, setKbSearchQuery] = useState('');
  const [kbSearchResult, setKbSearchResult] = useState<string | null>(null);
  const [kbSearching, setKbSearching] = useState(false);
  const [form, setForm] = useState({
    retell_api_key: '',
    retell_phone_number: '',
    retell_agent_id: '',
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
  });

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
      // Poll for updated status after a delay
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
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/settings', form);
      showToast('Settings saved successfully!', 'success');
      fetchSettings();
    } catch (err) {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };



  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <RefreshCw className="animate-spin" style={{ animation: 'spin 2s linear infinite' }} size={30} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800 }}>System Settings</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Configure API connections, security credentials and dial options</p>
      </div>

      <form onSubmit={saveSettings} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
        
        {/* API Configurations */}
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Cpu size={20} style={{ color: 'var(--accent-primary)' }} />
              Retell AI Voice Integration
            </h3>

            <div className="form-group">
              <label className="form-label">Retell API Key</label>
              <input 
                type="password" 
                name="retell_api_key" 
                className="form-input" 
                value={form.retell_api_key} 
                onChange={handleInputChange}
                placeholder="Enter Retell API authorization key"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Outbound Phone Number</label>
              <input 
                type="text" 
                name="retell_phone_number" 
                className="form-input" 
                value={form.retell_phone_number} 
                onChange={handleInputChange}
                placeholder="+18645812715"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Voice Agent ID</label>
              <input 
                type="text" 
                name="retell_agent_id" 
                className="form-input" 
                value={form.retell_agent_id} 
                onChange={handleInputChange}
                placeholder="agent_..."
              />
            </div>



            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <RefreshCw size={20} style={{ color: 'var(--accent-success)' }} />
              Ngrok Webhook Tunnel
            </h3>

            <div className="form-group">
              <label className="form-label">Ngrok Auth Token</label>
              <input 
                type="password" 
                name="ngrok_auth_token" 
                className="form-input" 
                value={form.ngrok_auth_token || ''} 
                onChange={handleInputChange}
                placeholder="Enter Ngrok Auth Token for public tunnel"
              />
            </div>

            {form.ngrok_url && (
              <div className="form-group">
                <label className="form-label">Active Tunnel Webhook URL (Read Only)</label>
                <input 
                  type="text" 
                  name="ngrok_url" 
                  className="form-input" 
                  value={`${form.ngrok_url}/api/webhooks/retell`} 
                  disabled
                  style={{ opacity: 0.8, color: 'var(--accent-success)', borderColor: 'var(--accent-success)', cursor: 'default' }}
                />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Set this endpoint as the Webhook URL in your Retell AI developer console:
                  <strong style={{ color: 'var(--text-primary)', display: 'block', wordBreak: 'break-all', marginTop: '4px' }}>
                    {form.ngrok_url}/api/webhooks/retell
                  </strong>
                </span>
              </div>
            )}

            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CalendarRange size={20} style={{ color: 'var(--accent-secondary)' }} />
              Google Calendar Integration
            </h3>

            <div className="form-group">
              <label className="form-label">Google Service Account Credentials (JSON)</label>
              <textarea 
                name="google_calendar_credentials_json" 
                className="form-input" 
                rows={5}
                value={form.google_calendar_credentials_json || ''} 
                onChange={handleInputChange}
                placeholder='Paste your Google Service Account JSON key content here'
                style={{ fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Google Calendar ID</label>
              <input 
                type="text" 
                name="google_calendar_id" 
                className="form-input" 
                value={form.google_calendar_id || ''} 
                onChange={handleInputChange}
                placeholder="e.g. primary or your-school-calendar@group.calendar.google.com"
              />
            </div>

            {/* Google Calendar Setup Instructions */}
            <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '10px', padding: '16px', fontSize: '0.85rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CalendarRange size={15} /> Google Calendar Setup Checklist
              </div>
              <ol style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', lineHeight: 2 }}>
                <li>Create a <strong style={{ color: 'var(--text-primary)' }}>Google Service Account</strong> in your Google Cloud Console.</li>
                <li>Enable the <strong style={{ color: 'var(--text-primary)' }}>Google Calendar API</strong> for your project.</li>
                <li>Create and download a new private key in <strong style={{ color: 'var(--text-primary)' }}>JSON format</strong> for the Service Account, and paste it above.</li>
                <li>Share your target Google Calendar with the Service Account email address, granting <strong style={{ color: 'var(--text-primary)' }}>"Make changes to events"</strong> permission.</li>
                <li>Enter the target Google Calendar ID above (usually your email, or a long string from Calendar settings).</li>
              </ol>
            </div>
          </div>

        {/* Integration Status Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>


          {/* Quick FAQ / Guide */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HelpCircle size={18} style={{ color: 'var(--accent-warning)' }} />
              Developer Sandbox Details
            </h3>
            <ul style={{ listStyleType: 'disc', paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <li>Retell calls are dispatched using a E.164 phone number.</li>
              <li>A sandbox simulator automatically intercepts calls when a mock Retell key or invalid number is used to allow testing rescheduling and webhook flows.</li>
            </ul>
          </div>

          {/* SMTP Email Configuration Panel */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mail size={18} style={{ color: 'var(--accent-primary)' }} />
              SMTP Email Integration
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: 0 }}>
              Configure SMTP settings to automatically send appointment confirmation emails to callers.
            </p>

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">SMTP Host</label>
              <input 
                type="text" 
                name="smtp_server" 
                className="form-input" 
                value={form.smtp_server || ''} 
                onChange={handleInputChange}
                placeholder="smtp.gmail.com"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">SMTP Port</label>
              <input 
                type="text" 
                name="smtp_port" 
                className="form-input" 
                value={form.smtp_port || '587'} 
                onChange={handleInputChange}
                placeholder="587"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">SMTP Username</label>
              <input 
                type="text" 
                name="smtp_username" 
                className="form-input" 
                value={form.smtp_username || ''} 
                onChange={handleInputChange}
                placeholder="admissions@tsra.edu.in"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">SMTP Password</label>
              <input 
                type="password" 
                name="smtp_password" 
                className="form-input" 
                value={form.smtp_password || ''} 
                onChange={handleInputChange}
                placeholder="••••••••••••••••"
              />
            </div>

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">Sender From Email</label>
              <input 
                type="email" 
                name="smtp_from_email" 
                className="form-input" 
                value={form.smtp_from_email || ''} 
                onChange={handleInputChange}
                placeholder="admissions@tsra.edu.in"
              />
            </div>
          </div>

          {/* Dialer Configuration Panel */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={18} style={{ color: 'var(--accent-primary)' }} />
              Dialer Configuration
            </h3>
            
            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">Max Concurrency Limit</label>
              <input 
                type="number" 
                name="concurrency_limit" 
                className="form-input" 
                value={form.concurrency_limit || '1'} 
                onChange={handleInputChange}
                min="1"
                max="10"
                placeholder="E.g. 1"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>Max number of simultaneous calls</span>
            </div>

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">Max Retry Attempts</label>
              <input 
                type="number" 
                name="max_retry_attempts" 
                className="form-input" 
                value={form.max_retry_attempts || '3'} 
                onChange={handleInputChange}
                min="0"
                max="5"
                placeholder="E.g. 3"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>For unanswered calls or voicemails</span>
            </div>

            <div className="form-group" style={{ marginBottom: '10px' }}>
              <label className="form-label">Retry Backoff (Hours)</label>
              <input 
                type="number" 
                name="retry_backoff_hours" 
                className="form-input" 
                value={form.retry_backoff_hours || '2'} 
                onChange={handleInputChange}
                min="1"
                max="24"
                placeholder="E.g. 2"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>Hours to wait before redialing</span>
            </div>
            
            <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: '10px' }} disabled={saving}>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>

          {/* Knowledge Base Panel */}
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={18} style={{ color: '#7c3aed' }} />
              AI Knowledge Base
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', margin: 0 }}>
              The AI agent uses this knowledge base to answer questions about TSRA during calls. It is scraped from the school website.
            </p>

            {/* Status display */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {[
                { label: 'Knowledge Chunks', value: kbStatus ? kbStatus.total_chunks : '…', color: kbStatus && kbStatus.total_chunks > 0 ? 'var(--accent-success)' : 'var(--accent-error)' },
                { label: 'URLs Monitored', value: kbStatus ? kbStatus.urls_monitored : '…', color: 'var(--accent-primary)' },
                { label: 'Last Scraped', value: kbStatus?.last_scraped ? new Date(kbStatus.last_scraped + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never', color: kbStatus?.last_scraped ? 'var(--accent-success)' : 'var(--accent-error)' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {kbStatus && kbStatus.total_chunks === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', fontSize: '0.85rem', color: '#f87171' }}>
                <AlertTriangle size={16} />
                <span>Knowledge base is empty! The AI will not be able to answer school questions during calls. Click <strong>Refresh Now</strong> to seed it.</span>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '8px' }}
              onClick={refreshKnowledgeBase}
              disabled={kbRefreshing}
            >
              <RefreshCw size={15} style={{ animation: kbRefreshing ? 'spin 1.5s linear infinite' : 'none' }} />
              {kbRefreshing ? 'Refreshing...' : 'Refresh Now'}
            </button>

            {/* Test search */}
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
                <BookOpen size={13} style={{ display: 'inline', marginRight: '4px' }} /> Test Search
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="e.g. fees, IB curriculum, admission process"
                  value={kbSearchQuery}
                  onChange={e => setKbSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && searchKnowledgeBase()}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
                  onClick={searchKnowledgeBase}
                  disabled={kbSearching}
                >
                  <Search size={14} />
                  {kbSearching ? 'Searching...' : 'Search'}
                </button>
              </div>
              {kbSearchResult && (
                <div style={{ marginTop: '12px', background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: '10px', padding: '14px', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  <div style={{ fontWeight: 700, color: '#7c3aed', marginBottom: '6px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Result</div>
                  {kbSearchResult}
                </div>
              )}
            </div>
          </div>

        </div>

      </form>
    </div>
  );
}
