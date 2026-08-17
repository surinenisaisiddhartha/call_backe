import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import {
  PhoneCall, ShieldCheck, CheckCircle2, AlertTriangle, RefreshCw, Radio,
  Zap, ArrowRight, Settings2, Key, Phone, Bot, Check, X, RotateCcw,
  Sparkles, Layers, Activity, ChevronRight, HelpCircle, Server, ArrowLeft
} from 'lucide-react';

interface ProviderItem {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  status: 'draft' | 'ready' | 'active' | 'error';
  agent_id: string;
  phone_number: string;
  telephony_provider: string;
  capabilities: {
    supports_native_transfer: boolean;
    supports_realtime_transcription: boolean;
    supports_byo_telephony: boolean;
    supports_batch_dispatch: boolean;
    supports_sip_trunking: boolean;
    supports_cost_metrics: boolean;
    supports_custom_tools: boolean;
  };
  has_key: boolean;
}

interface ValidationResult {
  provider: string;
  connected: boolean;
  agent_configured: boolean;
  phone_configured: boolean;
  webhook_configured: boolean;
  ready: boolean;
  missing_fields: string[];
  error_message?: string;
}

interface VoiceProvidersProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onProviderChanged?: (newProvider: string) => void;
}

// Provider Names & Architecture Details for Admin Console
const GATEWAY_NAMES: Record<string, { title: string; subtitle: string; tag: string; providerName: string }> = {
  retell: {
    title: 'Retell AI',
    subtitle: 'Ultra-low latency conversational engine with native counselor transfer and neural speech synthesis.',
    tag: 'Primary Neural Engine',
    providerName: 'Retell AI Engine'
  },
  omnidimension: {
    title: 'OmniDimension AI',
    subtitle: 'High-concurrency conversational engine with deep knowledge-base RAG and custom tool routing.',
    tag: 'Enterprise RAG Engine',
    providerName: 'OmniDimension API'
  },
  bolna: {
    title: 'Bolna AI',
    subtitle: 'Dynamic execution gateway with multi-region carrier telephony and speech pipeline integration.',
    tag: 'Telephony & SIP Engine',
    providerName: 'Bolna Voice API'
  }
};

export default function VoiceProviders({ showToast, onProviderChanged }: VoiceProvidersProps) {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [schools, setSchools] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [activeProvider, setActiveProvider] = useState<string>('retell');
  const [validating, setValidating] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<Record<string, ValidationResult>>({});
  const [configuringProvider, setConfiguringProvider] = useState<ProviderItem | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [agentIdInput, setAgentIdInput] = useState('');
  const [phoneNumberInput, setPhoneNumberInput] = useState('');
  const [telephonyInput, setTelephonyInput] = useState('managed');
  const [savingConfig, setSavingConfig] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  const fetchSchools = async () => {
    try {
      const res = await api.get('/schools');
      setSchools(res.data || []);
    } catch (err) {
      // Non-admin or single-tenant user
    }
  };

  const fetchProviders = async (schoolId?: string) => {
    setLoading(true);
    const targetSchool = schoolId !== undefined ? schoolId : selectedSchoolId;
    try {
      const res = await api.get('/providers', {
        params: { school_id: targetSchool || undefined }
      });
      setProviders(res.data);
      const current = res.data.find((p: ProviderItem) => p.is_active);
      if (current) setActiveProvider(current.id);
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to load voice gateways'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchools();
    fetchProviders();
  }, []);

  const handleSchoolChange = (newSchoolId: string) => {
    setSelectedSchoolId(newSchoolId);
    fetchProviders(newSchoolId);
  };

  const handleValidate = async (providerId: string) => {
    setValidating(providerId);
    try {
      const res = await api.post(`/providers/${providerId}/validate`, null, {
        params: { school_id: selectedSchoolId || undefined }
      });
      setValidationResults(prev => ({ ...prev, [providerId]: res.data }));
      const gName = GATEWAY_NAMES[providerId]?.title || 'Gateway';
      if (res.data.ready) {
        showToast(`✔ ${gName} validation successful! Ready for live calls.`, 'success');
      } else {
        showToast(`Validation warning: ${res.data.missing_fields?.join(', ') || res.data.error_message}`, 'error');
      }
    } catch (err) {
      showToast(getErrorMessage(err, `Validation failed`), 'error');
    } finally {
      setValidating(null);
    }
  };

  const handleActivate = async (providerId: string) => {
    setActivating(providerId);
    try {
      await api.post(`/providers/${providerId}/activate`, null, {
        params: { school_id: selectedSchoolId || undefined }
      });
      const gName = GATEWAY_NAMES[providerId]?.title || 'Gateway';
      const targetSchoolName = schools.find(s => s.id === selectedSchoolId)?.name;
      showToast(`Switched active voice routing to ${gName}${targetSchoolName ? ` for ${targetSchoolName}` : ''}`, 'success');
      setActiveProvider(providerId);
      if (onProviderChanged) onProviderChanged(providerId);
      await fetchProviders();
    } catch (err) {
      showToast(getErrorMessage(err, `Failed to activate voice gateway`), 'error');
    } finally {
      setActivating(null);
    }
  };

  const handleRollback = async () => {
    setRollingBack(true);
    try {
      const res = await api.post('/providers/rollback', null, {
        params: { school_id: selectedSchoolId || undefined }
      });
      const gName = GATEWAY_NAMES[res.data.active_provider]?.title || 'Previous Gateway';
      showToast(`Rolled back to ${gName}`, 'success');
      setActiveProvider(res.data.active_provider);
      if (onProviderChanged) onProviderChanged(res.data.active_provider);
      await fetchProviders();
    } catch (err) {
      showToast(getErrorMessage(err, 'Rollback failed'), 'error');
    } finally {
      setRollingBack(false);
    }
  };

  const openConfigModal = (p: ProviderItem) => {
    setConfiguringProvider(p);
    setApiKeyInput('');
    setAgentIdInput(p.agent_id || '');
    setPhoneNumberInput(p.phone_number || '');
    setTelephonyInput(p.telephony_provider || 'managed');
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configuringProvider) return;
    setSavingConfig(true);
    try {
      await api.post(`/providers/${configuringProvider.id}/config`, {
        api_key: apiKeyInput || undefined,
        agent_id: agentIdInput || undefined,
        phone_number: phoneNumberInput || undefined,
        telephony_provider: telephonyInput || undefined
      }, {
        params: { school_id: selectedSchoolId || undefined }
      });
      showToast(`Configuration updated for ${GATEWAY_NAMES[configuringProvider.id]?.title || 'Gateway'}`, 'success');
      setConfiguringProvider(null);
      await fetchProviders();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save gateway configuration'), 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const activeInfo = GATEWAY_NAMES[activeProvider] || { title: 'Voice Gateway Alpha', subtitle: '', tag: 'Active' };

  return (
    <div className="page-container animate-fade-in" style={{ padding: '28px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Back Navigation Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
        <button
          onClick={() => window.history.length > 1 ? window.history.back() : (window.location.hash = '#billing')}
          className="btn btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px' }}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>/</span>
        <a href="#billing" style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textDecoration: 'none' }}>Usage &amp; Billing</a>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600 }}>Voice AI Infrastructure</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              AI Voice Infrastructure &amp; Gateways
            </h1>
            <span style={{
              background: 'rgba(16, 185, 129, 0.12)',
              color: 'var(--accent-primary)',
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '0.78rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <Activity size={13} className="animate-pulse" />
              Multi-Gateway Engine
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px', marginBottom: 0 }}>
            Manage voice AI execution gateways, telephony carrier routing, and encryption tokens with zero changes to CRM pipelines.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            className="btn-secondary"
            onClick={handleRollback}
            disabled={rollingBack}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 15px', fontSize: '0.85rem' }}
          >
            <RotateCcw size={15} className={rollingBack ? 'animate-spin' : ''} />
            Rollback Gateway
          </button>
          <button
            className="btn-primary"
            onClick={() => fetchProviders()}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 15px', fontSize: '0.85rem' }}
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* School / Tenant Scope Selector */}
      {schools && schools.length > 0 && (
        <div className="glass-panel" style={{
          padding: '14px 18px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Server size={18} color="var(--accent-primary)" />
            <div>
              <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>Target School Configuration Scope</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Switch and configure voice engines per school or for global platform default
              </div>
            </div>
          </div>
          <select
            value={selectedSchoolId}
            onChange={(e) => handleSchoolChange(e.target.value)}
            className="form-input"
            style={{ minWidth: '260px', fontWeight: 600, fontSize: '0.85rem' }}
          >
            <option value="">🌐 Platform Default (Global)</option>
            {schools.map(s => (
              <option key={s.id} value={s.id}>
                🏫 {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Active Gateway Indicator Banner */}
      <div className="card" style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(6,182,212,0.05) 100%)',
        border: '1px solid rgba(16,185,129,0.25)',
        padding: '18px 22px',
        borderRadius: '14px',
        marginBottom: '28px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: 'var(--accent-gradient)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)'
          }}>
            <Radio size={22} className="animate-pulse" />
          </div>
          <div>
            <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontWeight: 600 }}>
              Active Voice Infrastructure
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              {activeInfo.title}
              <span style={{
                background: 'rgba(34,197,94,0.15)',
                color: 'var(--accent-success)',
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '12px',
                fontWeight: 600
              }}>
                ● ONLINE & ROUTING CALLS
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <div><strong>Caller ID:</strong> {providers.find(p => p.id === activeProvider)?.phone_number || '+918047360000'}</div>
          <div><strong>Telephony Trunk:</strong> {providers.find(p => p.id === activeProvider)?.telephony_provider || 'Managed Carrier'}</div>
        </div>
      </div>

      {/* Gateway Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '22px' }}>
        {providers.map((p) => {
          const isActive = p.id === activeProvider;
          const validation = validationResults[p.id];
          const info = GATEWAY_NAMES[p.id] || { title: 'Voice Gateway', subtitle: p.description, tag: 'Gateway' };

          return (
            <div
              key={p.id}
              className="card hover-lift"
              style={{
                borderRadius: '16px',
                padding: '24px',
                border: isActive ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: isActive ? 'var(--bg-secondary)' : 'var(--bg-card)',
                boxShadow: isActive ? '0 8px 30px rgba(16,185,129,0.12)' : 'var(--shadow-sm)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative'
              }}
            >
              {isActive && (
                <div style={{
                  position: 'absolute',
                  top: '-12px',
                  right: '20px',
                  background: 'var(--accent-gradient)',
                  color: '#fff',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  padding: '3px 12px',
                  borderRadius: '12px',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  boxShadow: '0 2px 8px rgba(16,185,129,0.4)'
                }}>
                  Active Gateway
                </div>
              )}

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      {info.title}
                    </h3>
                    <span style={{ fontSize: '0.72rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                      {info.tag}
                    </span>
                  </div>
                  <span style={{
                    padding: '4px 10px',
                    borderRadius: '8px',
                    fontSize: '0.76rem',
                    fontWeight: 600,
                    background: p.has_key ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.15)',
                    color: p.has_key ? 'var(--accent-success)' : 'var(--accent-warning)'
                  }}>
                    {p.has_key ? 'Credentials Configured' : 'Missing Secret Token'}
                  </span>
                </div>

                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', minHeight: '38px', marginBottom: '18px', lineHeight: 1.45 }}>
                  {info.subtitle}
                </p>

                {/* Status & Attributes */}
                <div style={{
                  background: 'var(--bg-tertiary)',
                  padding: '14px',
                  borderRadius: '10px',
                  marginBottom: '18px',
                  fontSize: '0.82rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Assigned Admission Agent:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{p.agent_id || 'Default Admission Agent'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Outbound Caller ID:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{p.phone_number || 'None'}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Carrier Telephony:</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{p.telephony_provider || 'Managed Carrier'}</strong>
                  </div>
                </div>

                {/* Capabilities Badges */}
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '8px' }}>
                    Gateway Capabilities
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    <span className="badge-pill" style={{ background: 'rgba(16,185,129,0.12)', color: 'var(--accent-primary)' }}>
                      ✔ Native Counselor Transfer
                    </span>
                    <span className="badge-pill" style={{ background: 'rgba(6,182,212,0.12)', color: 'var(--accent-cyan)' }}>
                      ✔ Carrier SIP & BYO Trunk
                    </span>
                    <span className="badge-pill" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--accent-success)' }}>
                      ✔ Batch Campaign API
                    </span>
                    <span className="badge-pill" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--accent-warning)' }}>
                      ✔ Mid-Call Knowledge Tools
                    </span>
                  </div>
                </div>

                {/* Validation Feedback */}
                {validation && (
                  <div style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    fontSize: '0.8rem',
                    background: validation.ready ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${validation.ready ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    color: validation.ready ? 'var(--accent-success)' : 'var(--accent-error)'
                  }}>
                    {validation.ready ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <CheckCircle2 size={15} /> All gateway connection checks passed!
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <AlertTriangle size={15} /> Validation Notice
                        </div>
                        <div style={{ marginTop: '4px', fontSize: '0.76rem' }}>
                          {validation.error_message || `Missing: ${validation.missing_fields?.join(', ')}`}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  className="btn-secondary"
                  onClick={() => openConfigModal(p)}
                  style={{ flex: 1, fontSize: '0.83rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '9px 12px' }}
                >
                  <Settings2 size={14} /> Configure
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleValidate(p.id)}
                  disabled={validating === p.id}
                  style={{ fontSize: '0.83rem', padding: '9px 12px' }}
                >
                  {validating === p.id ? <RefreshCw size={14} className="animate-spin" /> : 'Test'}
                </button>
                <button
                  className={isActive ? 'btn-secondary' : 'btn-primary'}
                  onClick={() => handleActivate(p.id)}
                  disabled={isActive || activating === p.id}
                  style={{ flex: 1.2, fontSize: '0.83rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '9px 12px' }}
                >
                  {isActive ? (
                    <>
                      <Check size={14} /> Active
                    </>
                  ) : activating === p.id ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <>
                      <Zap size={14} /> Activate
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Configuration Modal */}
      {configuringProvider && (
        <div className="app-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setConfiguringProvider(null); }}>
          <div className="app-modal-dialog">
            <div className="app-modal-header">
              <h3 className="app-modal-title">
                <Key size={20} color="var(--accent-primary)" />
                Configure {GATEWAY_NAMES[configuringProvider.id]?.title || 'Voice Gateway'}
              </h3>
              <button
                className="btn btn-secondary"
                style={{ padding: '6px' }}
                onClick={() => setConfiguringProvider(null)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveConfig}>
              <div className="app-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Gateway Secret Token / API Key
                  </label>
                  <input
                    type="password"
                    placeholder={configuringProvider.has_key ? '•••••••••••••••• (Leave blank to keep current)' : 'Paste Secret Token here'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="input-field"
                    style={{ width: '100%' }}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
                    Encrypted using AES-256 at rest. Never exposed in browser code.
                  </span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Default Admission Agent ID
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. agent_12345 or 158910"
                    value={agentIdInput}
                    onChange={(e) => setAgentIdInput(e.target.value)}
                    className="input-field"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Outbound Caller ID (Phone Number)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. +918047360000 or +18645812715"
                    value={phoneNumberInput}
                    onChange={(e) => setPhoneNumberInput(e.target.value)}
                    className="input-field"
                    style={{ width: '100%' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    Carrier Telephony Routing
                  </label>
                  <select
                    value={telephonyInput}
                    onChange={(e) => setTelephonyInput(e.target.value)}
                    className="input-field"
                    style={{ width: '100%' }}
                  >
                    <option value="managed">Direct Cloud Carrier (Recommended)</option>
                    <option value="exotel">Exotel India</option>
                    <option value="twilio">Twilio Global</option>
                    <option value="sip">Custom SIP Carrier Trunk</option>
                  </select>
                </div>
              </div>

              <div className="app-modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setConfiguringProvider(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingConfig}
                >
                  {savingConfig ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
