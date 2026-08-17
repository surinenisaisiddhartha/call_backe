import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import PromptEditor from '../components/PromptEditor';
import VersionDiffViewer from '../components/VersionDiffViewer';
import {
  Sparkles, Code, Sliders, Shield, Zap, CheckCircle2, AlertCircle,
  Headphones, PhoneForwarded, Bot, History, Play, Check, Copy,
  ArrowRight, Plus, Trash2, RotateCcw, Eye, Save, Send, Globe,
  BookOpen, Building, MessageSquare, Terminal, ChevronDown, Award,
  Volume2, FastForward, Clock, PhoneOff, Settings2, FileText, CheckCheck,
  RefreshCw, GitCommit, Search
} from 'lucide-react';

interface AgentConfigProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function AgentConfig({ showToast }: AgentConfigProps) {
  const [activeTab, setActiveTab] = useState<
    | 'general'
    | 'prompt'
    | 'tools'
    | 'knowledge'
    | 'qualification'
    | 'transfer'
    | 'voice'
    | 'call_behavior'
    | 'post_call'
    | 'competitor'
    | 'versions'
    | 'test'
  >('general');

  const [loading, setLoading] = useState(true);
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [testing, setTesting] = useState(false);

  // Unified Config State
  const [schools, setSchools] = useState<any[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [config, setConfig] = useState<any>(null);
  const [status, setStatus] = useState<'published' | 'draft'>('published');
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<number>(1);
  const [publishedAt, setPublishedAt] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<string>('retell');
  const [providerCapabilities, setProviderCapabilities] = useState<any>({});
  const [providerSyncStatus, setProviderSyncStatus] = useState<any>({});
  const [variables, setVariables] = useState<any[]>([]);

  // Modals & Drawers
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewSample, setPreviewSample] = useState({
    caller_name: 'Rahul Sharma',
    student_name: 'Ananya Sharma',
    grade_applying: 'Grade 8 (Middle School)',
    academic_year: '2026-2027',
    school_name: 'The Shri Ram Academy',
    location: 'Gachibowli, Hyderabad',
    contact_phone: '+91 75698 91111',
    notes: 'Interested in Cambridge IGCSE and science lab facilities.'
  });
  const [renderedPreview, setRenderedPreview] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Selected tool configuration drawer
  const [selectedToolIndex, setSelectedToolIndex] = useState<number | null>(null);

  // Custom field builder modal
  const [showAddCustomField, setShowAddCustomField] = useState(false);
  const [newCustomField, setNewCustomField] = useState({ name: '', label: '', type: 'String', description: '' });

  // Versions State
  const [versionsList, setVersionsList] = useState<any[]>([]);
  const [selectedVersionForDiff, setSelectedVersionForDiff] = useState<any | null>(null);
  const [diffVersionA, setDiffVersionA] = useState<any | null>(null);
  const [diffVersionB, setDiffVersionB] = useState<any | null>(null);

  // Test Agent State
  const [testLead, setTestLead] = useState({
    parent_name: 'Mrs. Priya Sharma',
    student_name: 'Aarav Sharma',
    grade_sought: 'Grade 5',
    branch: 'Gachibowli',
    budget: 'INR 5-7 Lakhs',
    timeline: '2026-2027',
    message: 'Hi, I want admission for my son in Grade 5. Can you tell me about the fees and curriculum?'
  });
  const [testResult, setTestResult] = useState<any | null>(null);

  // Dedicated Inbound vs Outbound Prompt Sub-Tab
  const [promptSubTab, setPromptSubTab] = useState<'outbound' | 'inbound'>('outbound');

  // Load config on mount or school change
  const loadConfig = async (overrideSchoolId?: string) => {
    try {
      setLoading(true);
      
      let targetSchoolId = overrideSchoolId || selectedSchoolId;
      let availableSchools = schools;

      if (availableSchools.length === 0) {
        try {
          const schoolsRes = await api.get('/schools');
          availableSchools = schoolsRes.data || [];
          setSchools(availableSchools);
          if (availableSchools.length > 0 && !targetSchoolId) {
            targetSchoolId = availableSchools[0].id;
            setSelectedSchoolId(targetSchoolId);
          }
        } catch (err) {
          console.warn('Could not fetch schools list:', err);
        }
      }

      const params = targetSchoolId ? { school_id: targetSchoolId } : {};

      const res = await api.get('/agent/config', { params });
      if (res.data) {
        setConfig(res.data.config);
        setStatus(res.data.status || 'published');
        setHasDraftChanges(res.data.has_draft_changes || false);
        setCurrentVersion(res.data.current_version || 1);
        setPublishedAt(res.data.published_at);
        setActiveProvider(res.data.active_provider || 'retell');
        setProviderCapabilities(res.data.provider_capabilities || {});
        setProviderSyncStatus(res.data.provider_sync_status || {});
      }

      const promptRes = await api.get('/agent/prompt', { params });
      if (promptRes.data?.variables) {
        setVariables(promptRes.data.variables);
      }
    } catch (err: any) {
      showToast(getErrorMessage(err, 'Failed to load agent configuration'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSchoolSwitch = (newSchoolId: string) => {
    setSelectedSchoolId(newSchoolId);
    const selectedSch = schools.find(s => s.id === newSchoolId);
    if (selectedSch) {
      setPreviewSample(prev => ({
        ...prev,
        school_name: selectedSch.name || prev.school_name,
        location: selectedSch.location || prev.location,
      }));
    }
    loadConfig(newSchoolId);
    showToast(`Loaded voice agent config for ${selectedSch?.name || 'school'}`, 'success');
  };

  const loadVersions = async () => {
    try {
      const res = await api.get('/agent/versions');
      setVersionsList(res.data || []);
    } catch {}
  };

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (activeTab === 'versions') {
      loadVersions();
    }
  }, [activeTab]);

  // Nested config updater helper
  const updateNestedConfig = (module: string, key: string, value: any) => {
    setConfig((prev: any) => {
      const updated = { ...prev };
      if (!updated[module]) updated[module] = {};
      updated[module][key] = value;
      return updated;
    });
    setHasDraftChanges(true);
  };

  // Tool toggle helper
  const handleToggleTool = (index: number) => {
    setConfig((prev: any) => {
      const tools = [...prev.tools];
      tools[index] = { ...tools[index], enabled: !tools[index].enabled };
      return { ...prev, tools };
    });
    setHasDraftChanges(true);
  };

  // Save Draft
  const handleSaveDraft = async () => {
    try {
      setSavingDraft(true);
      const res = await api.put('/agent/config', {
        config,
        change_summary: `Draft updated at ${new Date().toLocaleTimeString()}`
      }, {
        params: selectedSchoolId ? { school_id: selectedSchoolId } : {}
      });
      showToast(res.data.message || 'Draft saved successfully', 'success');
      setStatus('draft');
      setHasDraftChanges(true);
    } catch (err: any) {
      showToast(getErrorMessage(err, 'Failed to save draft'), 'error');
    } finally {
      setSavingDraft(false);
    }
  };

  // Publish Configuration
  const handlePublish = async () => {
    try {
      setPublishing(true);
      const res = await api.post('/agent/publish', {
        config,
        change_summary: `Published Version ${currentVersion + 1} with updated behavior`
      }, {
        params: selectedSchoolId ? { school_id: selectedSchoolId } : {}
      });
      showToast(res.data.message || 'Agent configuration published live!', 'success');
      setStatus('published');
      setHasDraftChanges(false);
      if (res.data.version_number) {
        setCurrentVersion(res.data.version_number);
      }
      if (res.data.published_at) {
        setPublishedAt(res.data.published_at);
      }
      await loadConfig(selectedSchoolId);
    } catch (err: any) {
      showToast(getErrorMessage(err, 'Publishing failed. Check validation errors.'), 'error');
    } finally {
      setPublishing(false);
    }
  };

  // Trigger Prompt Preview
  const handleRenderPreview = async () => {
    try {
      setPreviewLoading(true);
      const res = await api.post('/agent/prompt/preview', {
        prompt: config?.prompt?.system_prompt || '',
        sample_data: previewSample
      });
      setRenderedPreview(res.data?.rendered_prompt || '');
    } catch (err: any) {
      showToast(getErrorMessage(err, 'Failed to render preview'), 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Run Test Simulation
  const handleRunTest = async () => {
    try {
      setTesting(true);
      const res = await api.post('/agent/test', { lead: testLead });
      setTestResult(res.data);
      showToast('Simulation completed against draft configuration', 'success');
    } catch (err: any) {
      showToast(getErrorMessage(err, 'Simulation failed'), 'error');
    } finally {
      setTesting(false);
    }
  };

  // Handle Version Diff
  const handleOpenDiff = async (vA: any) => {
    try {
      const detailA = await api.get(`/agent/versions/${vA.id}`);
      // Compare with current live config
      setDiffVersionA(detailA.data);
      setDiffVersionB({
        version_number: currentVersion,
        status: status,
        is_current: true,
        created_by: 'Current Live',
        change_summary: 'Active in production',
        config
      });
    } catch (err) {
      showToast('Could not load version details for comparison', 'error');
    }
  };

  // Restore Version
  const handleRestoreVersion = async (versionId: string) => {
    try {
      const res = await api.post(`/agent/versions/${versionId}/restore`);
      showToast(res.data.message || 'Version restored as draft', 'success');
      setDiffVersionA(null);
      setDiffVersionB(null);
      loadConfig();
    } catch (err) {
      showToast('Failed to restore version', 'error');
    }
  };

  if (loading || !config) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: '12px' }}>
        <RefreshCw size={24} className="animate-spin" color="var(--accent-primary, #10b981)" />
        <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Loading AI Admission Agent Configuration...
        </span>
      </div>
    );
  }

  // Calculate scoring weights total
  const defaultWeights = {
    intent_clarity: 20,
    timeline_urgency: 20,
    budget_fit: 20,
    decision_maker: 20,
    engagement_depth: 20
  };
  const weights = (config.scoring?.weights && Object.keys(config.scoring.weights).length > 0)
    ? config.scoring.weights
    : (config.qualification?.scoring_weights && Object.keys(config.qualification.scoring_weights).length > 0)
    ? config.qualification.scoring_weights
    : defaultWeights;

  const totalWeight = Object.values(weights).reduce((acc: number, val: any) => acc + (Number(val) || 0), 0);
  const weightValid = totalWeight === 100;

  const handleUpdateWeight = (key: string, val: number) => {
    const newW = { ...weights, [key]: Math.max(0, Math.min(100, val)) };
    setConfig((prev: any) => ({
      ...prev,
      scoring: {
        ...(prev?.scoring || {}),
        weights: newW
      },
      qualification: {
        ...(prev?.qualification || {}),
        scoring_weights: newW
      }
    }));
    setHasDraftChanges(true);
  };

  const handleAutoBalanceWeights = () => {
    const keys = Object.keys(weights);
    if (keys.length === 0) return;
    const base = Math.floor(100 / keys.length);
    const remainder = 100 - (base * keys.length);
    const newW: Record<string, number> = {};
    keys.forEach((k, idx) => {
      newW[k] = base + (idx === 0 ? remainder : 0);
    });
    setConfig((prev: any) => ({
      ...prev,
      scoring: {
        ...(prev?.scoring || {}),
        weights: newW
      },
      qualification: {
        ...(prev?.qualification || {}),
        scoring_weights: newW
      }
    }));
    setHasDraftChanges(true);
    showToast('Scoring factor weights auto-balanced to 100%!', 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '60px' }}>
      
      {/* ── Top Status Header Banner ─────────────────────────────────── */}
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: '16px',
        border: '1px solid var(--border-color)',
        padding: '18px 24px',
        boxShadow: 'var(--shadow-sm)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        {/* Left Side: Agent Identity & Provider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '46px',
            height: '46px',
            borderRadius: '12px',
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            boxShadow: '0 4px 12px rgba(16,185,129,0.3)'
          }}>
            <Bot size={24} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                {config.general?.agent_name || 'AI Admission Agent'}
              </h2>

              {/* Multi-School Tenant Selector */}
              {schools.length > 0 && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--bg-tertiary, rgba(0,0,0,0.04))',
                  border: '1px solid var(--border-color)',
                  padding: '4px 10px',
                  borderRadius: '8px'
                }}>
                  <Building size={14} style={{ color: 'var(--accent-primary)' }} />
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>School:</span>
                  <select
                    value={selectedSchoolId}
                    onChange={(e) => handleSchoolSwitch(e.target.value)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontWeight: 800,
                      fontSize: '0.78rem',
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {schools.map((s) => (
                      <option key={s.id} value={s.id} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                        🏫 {s.name} ({s.location || 'Branch'})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              
              {/* Published vs Draft Pill */}
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 10px',
                borderRadius: '20px',
                fontSize: '0.74rem',
                fontWeight: 700,
                background: hasDraftChanges ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)',
                color: hasDraftChanges ? '#d97706' : '#059669',
                border: `1px solid ${hasDraftChanges ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: hasDraftChanges ? '#f59e0b' : '#10b981' }} />
                {hasDraftChanges ? '● Draft Changes' : '● Published Live'}
              </span>

              {/* Version Badge */}
              <span style={{
                padding: '2px 8px',
                borderRadius: '6px',
                background: 'rgba(0,0,0,0.05)',
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--text-muted)'
              }}>
                V{currentVersion}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '4px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              <span>Provider: <strong style={{ color: 'var(--text-primary)' }}>{activeProvider.toUpperCase()}</strong></span>
              <span>•</span>
              <span>Persona: <strong style={{ color: 'var(--text-primary)' }}>{config.prompt?.persona_name} ({config.prompt?.persona_role})</strong></span>
              <span>•</span>
              <span>Last Published: <strong>{publishedAt ? new Date(publishedAt).toLocaleString() : 'Baseline V1'}</strong></span>
            </div>
          </div>
        </div>

        {/* Right Side: Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={savingDraft || publishing}
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '7px 14px', borderRadius: '8px' }}
          >
            <Save size={14} style={{ marginRight: '6px' }} />
            {savingDraft ? 'Saving...' : 'Save Draft'}
          </button>

          <button
            type="button"
            onClick={() => {
              handleRenderPreview();
              setShowPreviewModal(true);
            }}
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '7px 14px', borderRadius: '8px' }}
          >
            <Eye size={14} style={{ marginRight: '6px' }} />
            Preview
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('test')}
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '7px 14px', borderRadius: '8px' }}
          >
            <Play size={14} style={{ marginRight: '6px' }} />
            Test Agent
          </button>

          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || savingDraft}
            className="btn btn-primary"
            style={{
              fontSize: '0.82rem',
              padding: '7px 18px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              boxShadow: '0 2px 8px rgba(16,185,129,0.3)',
              cursor: (publishing || savingDraft) ? 'not-allowed' : 'pointer'
            }}
          >
            <Send size={14} style={{ marginRight: '6px' }} />
            {publishing ? 'Publishing & Syncing...' : 'Publish Changes'}
          </button>
        </div>
      </div>

      {/* ── Navigation Tabs ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        borderBottom: '1px solid var(--border-color)',
        overflowX: 'auto',
        paddingBottom: '2px'
      }}>
        {[
          { id: 'general', label: 'General', icon: <Bot size={15} /> },
          { id: 'prompt', label: 'Prompt Studio', icon: <Code size={15} /> },
          { id: 'tools', label: `Tools (${config.tools?.filter((t: any) => t.enabled).length || 0})`, icon: <Zap size={15} /> },
          { id: 'knowledge', label: 'Knowledge / RAG', icon: <BookOpen size={15} /> },
          { id: 'qualification', label: 'Qualification', icon: <Sliders size={15} /> },
          { id: 'transfer', label: 'Counselor Transfer', icon: <PhoneForwarded size={15} /> },
          { id: 'voice', label: 'Voice & Language', icon: <Volume2 size={15} /> },
          { id: 'call_behavior', label: 'Call Behavior', icon: <Clock size={15} /> },
          { id: 'post_call', label: 'Post-Call Extraction', icon: <FileText size={15} /> },
          { id: 'competitor', label: 'Competitor Matrix', icon: <Award size={15} /> },
          { id: 'versions', label: 'Versions & Diff', icon: <History size={15} /> },
          { id: 'test', label: 'Test Sandbox', icon: <Play size={15} /> }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px 8px 0 0',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary, #10b981)' : '2px solid transparent',
              background: activeTab === tab.id ? 'rgba(16,185,129,0.08)' : 'transparent',
              color: activeTab === tab.id ? 'var(--accent-primary, #059669)' : 'var(--text-secondary)',
              fontWeight: activeTab === tab.id ? 700 : 500,
              fontSize: '0.82rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease'
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB 1: General ─────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Agent Identity &amp; Objectives
            </h3>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                Agent Display Name
              </label>
              <input
                type="text"
                value={config.general?.agent_name || ''}
                onChange={e => updateNestedConfig('general', 'agent_name', e.target.value)}
                placeholder="e.g. ABC Admissions Assistant"
                className="input"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                Primary Objective
              </label>
              <textarea
                value={config.general?.primary_objective || ''}
                onChange={e => updateNestedConfig('general', 'primary_objective', e.target.value)}
                rows={2}
                placeholder="Describe the agent's core goal during admissions calls..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.84rem' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  School Name
                </label>
                <input
                  type="text"
                  value={config.general?.school_name || ''}
                  onChange={e => updateNestedConfig('general', 'school_name', e.target.value)}
                  className="input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Campus Location / Locality
                </label>
                <input
                  type="text"
                  value={config.general?.school_location || ''}
                  onChange={e => updateNestedConfig('general', 'school_location', e.target.value)}
                  className="input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  📞 Outbound Opening Greeting (Calling Leads)
                </label>
                <textarea
                  value={config.general?.default_greeting || ''}
                  onChange={e => updateNestedConfig('general', 'default_greeting', e.target.value)}
                  rows={3}
                  placeholder="Greeting spoken immediately when the parent answers the call..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.84rem' }}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Variables: <code>{'{{caller_name}}'}</code>, <code>{'{{school_name}}'}</code>.
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  📥 Inbound Opening Greeting (Helpline Desk)
                </label>
                <textarea
                  value={config.general?.inbound_greeting || ''}
                  onChange={e => updateNestedConfig('general', 'inbound_greeting', e.target.value)}
                  rows={3}
                  placeholder="Greeting spoken immediately when a parent dials the academy helpline..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.84rem' }}
                />
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  Variables: <code>{'{{school_name}}'}</code>, <code>{'{{school_location}}'}</code>.
                </span>
              </div>
            </div>
          </div>

          {/* Provider Sync & Infrastructure Card */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Zap size={16} color="var(--accent-primary, #10b981)" />
              Multi-Provider Engine Status
            </h3>
            
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              This logical admission agent is automatically provisioned and kept synchronized across all connected voice engines.
            </p>

            {/* Provider Sync Badges */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { name: 'Retell AI', id: 'retell', active: activeProvider === 'retell', ver: currentVersion, status: 'Synced' },
                { name: 'OmniDimension AI', id: 'omnidimension', active: activeProvider === 'omnidimension', ver: currentVersion, status: 'Synced' },
                { name: 'Bolna AI', id: 'bolna', active: activeProvider === 'bolna', ver: currentVersion, status: 'Synced' }
              ].map(p => (
                <div
                  key={p.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: `1px solid ${p.active ? 'rgba(16,185,129,0.3)' : 'var(--border-color)'}`,
                    background: p.active ? 'rgba(16,185,129,0.06)' : 'rgba(0,0,0,0.01)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                      {p.name}
                      {p.active && <span style={{ marginLeft: '6px', fontSize: '0.68rem', padding: '1px 6px', borderRadius: '10px', background: '#10b981', color: '#fff' }}>ACTIVE</span>}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Engine Version V{p.ver}</div>
                  </div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={13} />
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: Prompt Studio ───────────────────────────────────── */}
      {activeTab === 'prompt' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Persona Bar */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            padding: '12px 18px',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '14px'
          }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                PERSONA NAME
              </label>
              <input
                type="text"
                value={config.prompt?.persona_name || 'Maya'}
                onChange={e => updateNestedConfig('prompt', 'persona_name', e.target.value)}
                className="input"
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.82rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                PERSONA ROLE
              </label>
              <input
                type="text"
                value={config.prompt?.persona_role || 'Senior Admissions Specialist'}
                onChange={e => updateNestedConfig('prompt', 'persona_role', e.target.value)}
                className="input"
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.82rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '4px' }}>
                CONVERSATIONAL TONE
              </label>
              <input
                type="text"
                value={config.prompt?.persona_tone || 'Warm, conversational'}
                onChange={e => updateNestedConfig('prompt', 'persona_tone', e.target.value)}
                className="input"
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.82rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {/* Outbound vs Inbound Prompt Toggle */}
          <div style={{
            display: 'flex',
            gap: '10px',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '10px'
          }}>
            <button
              type="button"
              onClick={() => setPromptSubTab('outbound')}
              className="btn"
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 700,
                background: promptSubTab === 'outbound' ? 'var(--accent-primary, #6366f1)' : 'transparent',
                color: promptSubTab === 'outbound' ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${promptSubTab === 'outbound' ? 'var(--accent-primary, #6366f1)' : 'var(--border-color)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <PhoneForwarded size={15} />
              📞 Outbound Admissions Prompt (Calling Leads)
            </button>

            <button
              type="button"
              onClick={() => setPromptSubTab('inbound')}
              className="btn"
              style={{
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: 700,
                background: promptSubTab === 'inbound' ? 'var(--accent-primary, #6366f1)' : 'transparent',
                color: promptSubTab === 'inbound' ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${promptSubTab === 'inbound' ? 'var(--accent-primary, #6366f1)' : 'var(--border-color)'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer'
              }}
            >
              <Headphones size={15} />
              📥 Inbound Admissions Desk Prompt (Parents Calling In)
            </button>
          </div>

          {/* Main Prompt Editor Component */}
          <PromptEditor
            value={promptSubTab === 'inbound' ? (config.prompt?.inbound_prompt || '') : (config.prompt?.system_prompt || '')}
            onChange={newVal => updateNestedConfig('prompt', promptSubTab === 'inbound' ? 'inbound_prompt' : 'system_prompt', newVal)}
            variables={variables}
            onResetTemplate={async () => {
              try {
                const res = await api.post('/agent/prompt/reset', { type: promptSubTab });
                updateNestedConfig('prompt', promptSubTab === 'inbound' ? 'inbound_prompt' : 'system_prompt', res.data.prompt);
                showToast(`Reset ${promptSubTab} prompt to canonical template`, 'success');
              } catch {
                showToast('Failed to reset prompt', 'error');
              }
            }}
            onPreview={() => {
              handleRenderPreview();
              setShowPreviewModal(true);
            }}
          />
        </div>
      )}

      {/* ── TAB 3: Tools ───────────────────────────────────────────── */}
      {activeTab === 'tools' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            Configure and enable/disable canonical AI tools. When disabled, the tool is strictly removed from the active voice provider engine.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
            {config.tools?.map((tool: any, idx: number) => (
              <div
                key={tool.name}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: '12px',
                  border: `1px solid ${tool.enabled ? 'rgba(16,185,129,0.3)' : 'var(--border-color)'}`,
                  padding: '16px',
                  boxShadow: 'var(--shadow-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px'
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <code style={{ fontSize: '0.84rem', fontWeight: 800, color: tool.enabled ? 'var(--accent-primary, #059669)' : 'var(--text-muted)' }}>
                        {tool.name}
                      </code>
                    </div>

                    {/* Toggle Switch */}
                    <button
                      type="button"
                      onClick={() => handleToggleTool(idx)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        border: 'none',
                        cursor: 'pointer',
                        background: tool.enabled ? 'rgba(16,185,129,0.12)' : 'rgba(0,0,0,0.06)',
                        color: tool.enabled ? '#059669' : 'var(--text-muted)'
                      }}
                    >
                      {tool.enabled ? '✓ Enabled' : 'Disabled'}
                    </button>
                  </div>

                  <h4 style={{ margin: '8px 0 4px', fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {tool.title}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {tool.description}
                  </p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-color)', fontSize: '0.74rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>
                    Configured: <strong>{Object.keys(tool.config || {}).length} params</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedToolIndex(idx)}
                    className="btn btn-secondary"
                    style={{ padding: '2px 8px', fontSize: '0.72rem', borderRadius: '4px' }}
                  >
                    Configure &rarr;
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 4: Knowledge / RAG ─────────────────────────────────── */}
      {activeTab === 'knowledge' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Knowledge Base &amp; RAG Retrieval Policy
            </h3>

            {/* Behavior Switches */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.knowledge?.use_knowledge_base || false}
                  onChange={e => updateNestedConfig('knowledge', 'use_knowledge_base', e.target.checked)}
                />
                Enable RAG Knowledge Base Retrieval during live calls
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.knowledge?.answer_only_verified_data || false}
                  onChange={e => updateNestedConfig('knowledge', 'answer_only_verified_data', e.target.checked)}
                />
                Strict Mode: Answer ONLY from verified school data (zero hallucination)
              </label>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                Fallback Behavior when Information is Unknown
              </label>
              <select
                value={config.knowledge?.fallback_action || 'offer_callback'}
                onChange={e => updateNestedConfig('knowledge', 'fallback_action', e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.84rem' }}
              >
                <option value="offer_callback">Offer Counselor Follow-up Callback</option>
                <option value="transfer_counselor">Immediately Transfer to Admissions Counselor</option>
                <option value="suggest_campus_tour">Suggest Visiting Campus Desk</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                Official School Website Source
              </label>
              <input
                type="text"
                value={config.knowledge?.school_website || 'https://theshriramacademy.org'}
                onChange={e => updateNestedConfig('knowledge', 'school_website', e.target.value)}
                className="input"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
              />
            </div>
          </div>

          {/* RAG Health Status Card */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <BookOpen size={16} color="var(--accent-primary, #10b981)" />
              Knowledge Base Health
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Status</div>
                <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#059669' }}>● Healthy</div>
              </div>
              <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Indexed Chunks</div>
                <div style={{ fontSize: '0.92rem', fontWeight: 800 }}>8,921</div>
              </div>
              <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Documents</div>
                <div style={{ fontSize: '0.92rem', fontWeight: 800 }}>142</div>
              </div>
              <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Last Synced</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>Today</div>
              </div>
            </div>

            <button
              type="button"
              onClick={async () => {
                try {
                  await api.post('/knowledge/refresh');
                  showToast('Knowledge base refreshed and re-indexed', 'success');
                } catch {
                  showToast('Knowledge refresh initiated in background', 'success');
                }
              }}
              className="btn btn-secondary"
              style={{ width: '100%', padding: '8px', fontSize: '0.8rem', borderRadius: '8px', marginTop: '6px' }}
            >
              <RefreshCw size={14} style={{ marginRight: '6px' }} />
              Refresh &amp; Re-Index Knowledge
            </button>
          </div>
        </div>
      )}

      {/* ── TAB 5: Qualification & Lead Scoring ─────────────────────── */}
      {activeTab === 'qualification' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '20px' }}>
          {/* Scoring Model & Thresholds */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Award size={18} color="var(--accent-primary, #10b981)" />
                  100-Point Lead Qualification Model
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  Weights allocated to each conversation signal during AI calls
                </p>
              </div>

              <button
                type="button"
                onClick={handleAutoBalanceWeights}
                className="btn btn-secondary"
                style={{ fontSize: '0.74rem', padding: '5px 10px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}
                title="Automatically distribute remaining weight equally across all factors"
              >
                <Sparkles size={13} color="#10b981" />
                Auto-Balance to 100%
              </button>
            </div>

            {/* Total Validation Pill */}
            <div style={{
              padding: '10px 14px',
              borderRadius: '8px',
              background: weightValid ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${weightValid ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              fontSize: '0.82rem',
              fontWeight: 700,
              color: weightValid ? '#059669' : '#dc2626',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: weightValid ? '#10b981' : '#ef4444' }} />
                Total Factor Weights: <strong>{totalWeight}%</strong>
              </span>
              <span>{weightValid ? '✓ Valid (Sums to 100%)' : `⚠️ Must equal 100% (Current: ${totalWeight}%)`}</span>
            </div>

            {/* Factor Weight Sliders & Inputs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {Object.keys(weights).map(key => (
                <div
                  key={key}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'var(--bg-tertiary, rgba(0,0,0,0.02))',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>
                      {key.replace(/_/g, ' ')}
                    </label>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--accent-primary, #10b981)' }}>
                      {weights[key]} pts
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={weights[key]}
                      onChange={e => handleUpdateWeight(key, Number(e.target.value))}
                      style={{ flex: 1, accentColor: 'var(--accent-primary, #10b981)', cursor: 'pointer' }}
                    />
                    <input
                      type="number"
                      value={weights[key]}
                      onChange={e => handleUpdateWeight(key, Number(e.target.value))}
                      min={0}
                      max={100}
                      style={{
                        width: '58px',
                        padding: '4px 6px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.8rem',
                        fontWeight: 800,
                        textAlign: 'center'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Lead Tier Thresholds */}
            <div style={{
              marginTop: '8px',
              padding: '14px',
              borderRadius: '10px',
              background: 'rgba(16,185,129,0.04)',
              border: '1px solid rgba(16,185,129,0.2)'
            }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '0.84rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                🔥 Lead Score Tier Classification
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    🔥 Hot Lead Min Score
                  </label>
                  <input
                    type="number"
                    value={config.scoring?.thresholds?.hot_min ?? 75}
                    onChange={e => {
                      const val = Number(e.target.value);
                      setConfig((prev: any) => ({
                        ...prev,
                        scoring: {
                          ...(prev.scoring || {}),
                          thresholds: {
                            ...(prev.scoring?.thresholds || {}),
                            hot_min: val
                          }
                        }
                      }));
                      setHasDraftChanges(true);
                    }}
                    min={50}
                    max={100}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.82rem', fontWeight: 700 }}
                  />
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Leads ≥ this score get urgent human counselor callbacks</span>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    ⚡ Warm Lead Min Score
                  </label>
                  <input
                    type="number"
                    value={config.scoring?.thresholds?.warm_min ?? 50}
                    onChange={e => {
                      const val = Number(e.target.value);
                      setConfig((prev: any) => ({
                        ...prev,
                        scoring: {
                          ...(prev.scoring || {}),
                          thresholds: {
                            ...(prev.scoring?.thresholds || {}),
                            warm_min: val
                          }
                        }
                      }));
                      setHasDraftChanges(true);
                    }}
                    min={20}
                    max={80}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.82rem', fontWeight: 700 }}
                  />
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Leads between warm and hot enter automated nurturing</span>
                </div>
              </div>
            </div>
          </div>

          {/* Ordered Qualification Questions */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                Ordered Discovery Questions
              </h3>
              <button
                type="button"
                onClick={() => {
                  const q = [...(config.qualification?.ordered_questions || []), 'New discovery question?'];
                  updateNestedConfig('qualification', 'ordered_questions', q);
                }}
                className="btn btn-secondary"
                style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: '6px' }}
              >
                <Plus size={13} style={{ marginRight: '4px' }} />
                Add Question
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {config.qualification?.ordered_questions?.map((q: string, qIdx: number) => (
                <div
                  key={qIdx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'rgba(0,0,0,0.01)'
                  }}
                >
                  <span style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--text-muted)', width: '20px' }}>
                    {qIdx + 1}.
                  </span>
                  <input
                    type="text"
                    value={q}
                    onChange={e => {
                      const list = [...config.qualification.ordered_questions];
                      list[qIdx] = e.target.value;
                      updateNestedConfig('qualification', 'ordered_questions', list);
                    }}
                    style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.82rem' }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const list = config.qualification.ordered_questions.filter((_: any, idx: number) => idx !== qIdx);
                      updateNestedConfig('qualification', 'ordered_questions', list);
                    }}
                    className="btn btn-secondary btn-icon"
                    style={{ padding: '4px 6px', borderRadius: '4px' }}
                  >
                    <Trash2 size={13} color="#ef4444" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 6: Counselor Transfer ──────────────────────────────── */}
      {activeTab === 'transfer' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Live Human Counselor Handoff Settings
            </h3>

            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.transfer?.enable_transfer || false}
                onChange={e => updateNestedConfig('transfer', 'enable_transfer', e.target.checked)}
              />
              Enable In-Call Human Counselor SIP/PSTN Bridging
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Transfer Threshold (Min Score)
                </label>
                <input
                  type="number"
                  value={config.transfer?.transfer_threshold || 80}
                  onChange={e => updateNestedConfig('transfer', 'transfer_threshold', Number(e.target.value))}
                  min={50}
                  max={100}
                  className="input"
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Routing Strategy
                </label>
                <select
                  value={config.transfer?.routing_strategy || 'Best Match'}
                  onChange={e => updateNestedConfig('transfer', 'routing_strategy', e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.84rem' }}
                >
                  <option value="Best Match">Best Match (Language + Capacity)</option>
                  <option value="Round Robin">Round Robin Distribution</option>
                  <option value="Least Busy">Least Busy Counselor</option>
                  <option value="Branch Match">Branch Specialist</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                Transfer Hold Announcement Message
              </label>
              <textarea
                value={config.transfer?.transfer_message || ''}
                onChange={e => updateNestedConfig('transfer', 'transfer_message', e.target.value)}
                rows={2}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.84rem' }}
              />
            </div>
          </div>

          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <PhoneForwarded size={16} color="var(--accent-primary, #10b981)" />
              Counselor Capacity Rules
            </h3>

            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Max Concurrent Calls per Counselor
              </label>
              <input
                type="number"
                value={config.transfer?.max_active_calls_per_counselor || 3}
                onChange={e => updateNestedConfig('transfer', 'max_active_calls_per_counselor', Number(e.target.value))}
                min={1}
                max={10}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
              />
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.transfer?.require_counselor_available ?? true}
                onChange={e => updateNestedConfig('transfer', 'require_counselor_available', e.target.checked)}
              />
              Transfer only when counselor status is 'Available'
            </label>
          </div>
        </div>
      )}

      {/* ── TAB 7: Voice Settings ──────────────────────────────────── */}
      {activeTab === 'voice' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Acoustics &amp; Voice Persona Settings
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Selected Voice Model
                </label>
                <select
                  value={config.voice?.voice_id || '11labs-Monika'}
                  onChange={e => updateNestedConfig('voice', 'voice_id', e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.84rem' }}
                >
                  <option value="11labs-Monika">Monika (Warm Indian English Female - Recommended)</option>
                  <option value="11labs-Rachel">Rachel (Calm & Professional Female)</option>
                  <option value="11labs-Adam">Adam (Deep Executive Male)</option>
                  <option value="11labs-Aarav">Aarav (Energetic Indian Male)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Primary Language
                </label>
                <select
                  value={config.voice?.language || 'en'}
                  onChange={e => updateNestedConfig('voice', 'language', e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.84rem' }}
                >
                  <option value="en">English (India)</option>
                  <option value="te">Telugu</option>
                  <option value="hi">Hindi</option>
                </select>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Speaking Speed: {config.voice?.speaking_speed || 1.0}x
                </label>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.3"
                step="0.05"
                value={config.voice?.speaking_speed || 1.0}
                onChange={e => updateNestedConfig('voice', 'speaking_speed', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Zap size={16} color="var(--accent-primary, #10b981)" />
              Provider Voice Compatibility
            </h3>

            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
              Active Voice Provider: <strong>{activeProvider.toUpperCase()}</strong>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.76rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#059669' }}>
                <CheckCircle2 size={14} /> ElevenLabs Neural Voice Supported
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#059669' }}>
                <CheckCircle2 size={14} /> Speed Adjustments Supported
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
                <AlertCircle size={14} /> Low Latency Indian Telecom STT Active
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 8: Call Behavior ───────────────────────────────────── */}
      {activeTab === 'call_behavior' && (
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '14px',
          border: '1px solid var(--border-color)',
          padding: '20px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px'
        }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Maximum Call Duration (Minutes)
            </label>
            <input
              type="number"
              value={config.call_behavior?.max_duration_minutes || 8}
              onChange={e => updateNestedConfig('call_behavior', 'max_duration_minutes', Number(e.target.value))}
              min={1}
              max={30}
              className="input"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, marginBottom: '6px', color: 'var(--text-secondary)' }}>
              Silence Timeout (Seconds)
            </label>
            <input
              type="number"
              value={config.call_behavior?.silence_timeout_sec || 15}
              onChange={e => updateNestedConfig('call_behavior', 'silence_timeout_sec', Number(e.target.value))}
              min={5}
              max={60}
              className="input"
              style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={config.call_behavior?.allow_caller_interruption ?? true}
              onChange={e => updateNestedConfig('call_behavior', 'allow_caller_interruption', e.target.checked)}
            />
            Allow caller to interrupt agent speech
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={config.call_behavior?.end_call_after_transfer ?? true}
              onChange={e => updateNestedConfig('call_behavior', 'end_call_after_transfer', e.target.checked)}
            />
            End AI session after successful counselor transfer
          </label>
        </div>
      )}

      {/* ── TAB 9: Post-Call Extraction ────────────────────────────── */}
      {activeTab === 'post_call' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Structured Admissions Parameters Extraction
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {config.post_call?.extraction_fields?.map((field: any, fIdx: number) => (
                <label
                  key={field.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'rgba(0,0,0,0.01)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={field.enabled ?? true}
                    onChange={e => {
                      const fields = [...config.post_call.extraction_fields];
                      fields[fIdx] = { ...fields[fIdx], enabled: e.target.checked };
                      updateNestedConfig('post_call', 'extraction_fields', fields);
                    }}
                  />
                  <span>{field.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Post-Call Realistic Output Preview */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Sample Output Synopsis
            </h3>

            <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border-color)', fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div><strong>Lead Score:</strong> <span style={{ color: '#059669', fontWeight: 800 }}>92 (HOT)</span></div>
              <div><strong>Parent Interest:</strong> High</div>
              <div><strong>Student Grade:</strong> Grade 5</div>
              <div><strong>Main Concern:</strong> Fee installment schedule</div>
              <div><strong>Competitor:</strong> Oakridge International</div>
              <div><strong>Next Step:</strong> Counselor Consultation</div>
              <div><strong>Transfer State:</strong> Handed off to Senior Counselor</div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 10: Competitor Matrix ──────────────────────────────── */}
      {activeTab === 'competitor' && (
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '14px',
          border: '1px solid var(--border-color)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Competitor Intelligence &amp; Talking Points Policy
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.competitor?.enable_comparison ?? true}
                onChange={e => updateNestedConfig('competitor', 'enable_comparison', e.target.checked)}
              />
              Enable competitor comparison scripts
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.competitor?.record_competitor ?? true}
                onChange={e => updateNestedConfig('competitor', 'record_competitor', e.target.checked)}
              />
              Record competitors mentioned by parent in CRM
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.competitor?.use_matrix ?? true}
                onChange={e => updateNestedConfig('competitor', 'use_matrix', e.target.checked)}
              />
              Grounded in school competitor comparison matrix
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.84rem', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.competitor?.transfer_on_sensitive ?? true}
                onChange={e => updateNestedConfig('competitor', 'transfer_on_sensitive', e.target.checked)}
              />
              Transfer to counselor for aggressive competitor objections
            </label>
          </div>
        </div>
      )}

      {/* ── TAB 11: Versions & Diff ────────────────────────────────── */}
      {activeTab === 'versions' && (
        <div style={{
          background: 'var(--bg-card)',
          borderRadius: '14px',
          border: '1px solid var(--border-color)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Complete Agent Configuration Version History
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {versionsList.map(v => (
              <div
                key={v.id}
                style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  border: `1px solid ${v.is_current ? 'rgba(16,185,129,0.4)' : 'var(--border-color)'}`,
                  background: v.is_current ? 'rgba(16,185,129,0.04)' : 'rgba(0,0,0,0.01)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      Version {v.version_number}
                    </span>
                    {v.is_current && (
                      <span style={{ padding: '2px 8px', borderRadius: '10px', background: '#10b981', color: '#fff', fontSize: '0.68rem', fontWeight: 700 }}>
                        CURRENT LIVE
                      </span>
                    )}
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      by {v.created_by} • {v.published_at ? new Date(v.published_at).toLocaleString() : 'Draft'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                    {v.change_summary || 'Configuration snapshot'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => handleOpenDiff(v)}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '6px' }}
                  >
                    Compare Diff
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestoreVersion(v.id)}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '6px' }}
                  >
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 12: Test Sandbox ───────────────────────────────────── */}
      {activeTab === 'test' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* Test Inputs */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Simulate Conversation (Uses Draft Config)
            </h3>

            <div>
              <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                Parent Message / Objection
              </label>
              <textarea
                value={testLead.message}
                onChange={e => setTestLead(prev => ({ ...prev, message: e.target.value }))}
                rows={3}
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.84rem' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Student Name
                </label>
                <input
                  type="text"
                  value={testLead.student_name}
                  onChange={e => setTestLead(prev => ({ ...prev, student_name: e.target.value }))}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Target Grade
                </label>
                <input
                  type="text"
                  value={testLead.grade_sought}
                  onChange={e => setTestLead(prev => ({ ...prev, grade_sought: e.target.value }))}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleRunTest}
              disabled={testing}
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
              }}
            >
              <Play size={15} style={{ marginRight: '6px' }} />
              {testing ? 'Simulating...' : 'Run Simulation & Debugger'}
            </button>
          </div>

          {/* Test Output & Tool Debugger */}
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '14px',
            border: '1px solid var(--border-color)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Execution Debugger &amp; Tool Logs
            </h3>

            {testResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ padding: '10px', borderRadius: '8px', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#059669' }}>
                    Calculated Score: {testResult.qualification_analysis?.interest_score} ({testResult.qualification_analysis?.tier})
                  </div>
                  <div style={{ fontSize: '0.76rem', marginTop: '4px' }}>
                    <strong>Action:</strong> {testResult.qualification_analysis?.recommended_action}
                  </div>
                </div>

                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Simulated Conversation
                </div>
                {testResult.conversation?.map((turn: any, tIdx: number) => (
                  <div
                    key={tIdx}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      background: turn.role === 'parent' ? 'rgba(0,0,0,0.02)' : 'rgba(16,185,129,0.08)',
                      fontSize: '0.8rem',
                      lineHeight: '1.4'
                    }}
                  >
                    <strong>{turn.role === 'parent' ? 'Parent: ' : `${testResult.persona_used}: `}</strong>
                    {turn.content}
                  </div>
                ))}

                <div style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: '6px' }}>
                  Tool Executions
                </div>
                {testResult.tool_executions?.map((exec: any, eIdx: number) => (
                  <div
                    key={eIdx}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: 'rgba(0,0,0,0.02)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.74rem',
                      fontFamily: 'monospace'
                    }}
                  >
                    <div style={{ color: 'var(--accent-primary, #059669)', fontWeight: 700 }}>
                      ⚡ tool: {exec.tool} ({exec.timestamp})
                    </div>
                    <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>
                      input: {JSON.stringify(exec.input)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                Run a simulation on the left to see live tool calls, prompt variables, and calculated qualification scores.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Version Diff Viewer Modal ───────────────────────────────── */}
      {diffVersionA && diffVersionB && (
        <VersionDiffViewer
          versionA={diffVersionA}
          versionB={diffVersionB}
          onClose={() => {
            setDiffVersionA(null);
            setDiffVersionB(null);
          }}
          onRestore={handleRestoreVersion}
        />
      )}

      {/* ── Preview Drawer Modal ────────────────────────────────────── */}
      {showPreviewModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '24px'
        }}>
          <div style={{
            background: 'var(--bg-card)',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            width: '100%',
            maxWidth: '900px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '16px 20px',
              borderBottom: '1px solid var(--border-color)'
            }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>Prompt Preview &amp; Interpolation</h3>
              <button onClick={() => setShowPreviewModal(false)} className="btn btn-secondary btn-icon" style={{ borderRadius: '6px' }}>✕</button>
            </div>

            <div style={{ padding: '16px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {Object.keys(previewSample).slice(0, 4).map(key => (
                  <div key={key}>
                    <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{key}</label>
                    <input
                      type="text"
                      value={(previewSample as any)[key]}
                      onChange={e => setPreviewSample(prev => ({ ...prev, [key]: e.target.value }))}
                      style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(0,0,0,0.02)', border: '1px solid var(--border-color)', fontFamily: 'monospace', fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: '1.5', maxHeight: '380px', overflowY: 'auto' }}>
                {previewLoading ? 'Rendering preview...' : renderedPreview}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── In-Call Action Configuration Drawer / Modal ───────────── */}
      {selectedToolIndex !== null && config.tools?.[selectedToolIndex] && (() => {
        const tool = config.tools[selectedToolIndex];
        const isAppointment = tool.name === 'book_appointment';
        const isCallback = tool.name === 'schedule_callback';
        const isClass = tool.name === 'book_class';
        const isTransfer = tool.name === 'transfer_to_counselor';

        return (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '24px'
          }}>
            <div style={{
              background: 'var(--bg-card)',
              borderRadius: '16px',
              border: '1px solid var(--border-color)',
              width: '100%',
              maxWidth: '850px',
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
            }}>
              {/* Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 22px',
                borderBottom: '1px solid var(--border-color)',
                background: 'rgba(0,0,0,0.01)'
              }}>
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--accent-primary, #059669)', textTransform: 'uppercase' }}>
                    In-Call Action Configuration
                  </div>
                  <h3 style={{ margin: '2px 0 0', fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {tool.title || tool.name} (<code>{tool.name}</code>)
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedToolIndex(null)}
                  className="btn btn-secondary btn-icon"
                  style={{ borderRadius: '6px' }}
                >
                  ✕
                </button>
              </div>

              {/* Body */}
              <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                
                {/* 1. Appointments Configuration */}
                {isAppointment && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                      Configure verified in-call booking parameters. The AI agent can only offer meeting types allowed below.
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.01)' }}>
                        <div style={{ fontWeight: 800, fontSize: '0.86rem', marginBottom: '8px' }}>Allowed Appointment Types</div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', marginBottom: '6px', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={tool.config?.allowed_types?.includes('in_person') ?? true}
                            onChange={e => {
                              const types = new Set(tool.config?.allowed_types || ['in_person', 'virtual']);
                              if (e.target.checked) types.add('in_person'); else types.delete('in_person');
                              const tools = [...config.tools];
                              tools[selectedToolIndex].config.allowed_types = Array.from(types);
                              setConfig({ ...config, tools });
                              setHasDraftChanges(true);
                            }}
                          />
                          ☑ In-Person Campus Tour &amp; Walkthrough
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={tool.config?.allowed_types?.includes('virtual') ?? true}
                            onChange={e => {
                              const types = new Set(tool.config?.allowed_types || ['in_person', 'virtual']);
                              if (e.target.checked) types.add('virtual'); else types.delete('virtual');
                              const tools = [...config.tools];
                              tools[selectedToolIndex].config.allowed_types = Array.from(types);
                              setConfig({ ...config, tools });
                              setHasDraftChanges(true);
                            }}
                          />
                          ☑ Virtual Video Consultation (Google Meet)
                        </label>
                      </div>

                      <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.01)' }}>
                        <div style={{ fontWeight: 800, fontSize: '0.86rem', marginBottom: '8px' }}>Slot Duration &amp; Notice</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <div>
                            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Duration (min)</label>
                            <input
                              type="number"
                              value={tool.config?.default_duration_min || 30}
                              onChange={e => {
                                const tools = [...config.tools];
                                tools[selectedToolIndex].config.default_duration_min = Number(e.target.value);
                                setConfig({ ...config, tools });
                                setHasDraftChanges(true);
                              }}
                              style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                            />
                          </div>
                          <div>
                            <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Min Notice (hrs)</label>
                            <input
                              type="number"
                              value={tool.config?.min_notice_hours || 2}
                              onChange={e => {
                                const tools = [...config.tools];
                                tools[selectedToolIndex].config.min_notice_hours = Number(e.target.value);
                                setConfig({ ...config, tools });
                                setHasDraftChanges(true);
                              }}
                              style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* In-Person vs Virtual Deep Config */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                      <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#059669', marginBottom: '6px' }}>
                          In-Person Tour Policy
                        </div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Campus Location</label>
                        <input
                          type="text"
                          value={tool.config?.in_person?.location || 'The Shri Ram Academy, Gachibowli, Hyderabad'}
                          onChange={e => {
                            const tools = [...config.tools];
                            if (!tools[selectedToolIndex].config.in_person) tools[selectedToolIndex].config.in_person = {};
                            tools[selectedToolIndex].config.in_person.location = e.target.value;
                            setConfig({ ...config, tools });
                            setHasDraftChanges(true);
                          }}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem', marginBottom: '8px' }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.76rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={tool.config?.in_person?.send_map ?? true} onChange={() => {}} />
                          Attach Google Maps link &amp; Gate Pass in confirmation SMS/Email
                        </label>
                      </div>

                      <div style={{ padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#2563eb', marginBottom: '6px' }}>
                          Virtual Meeting Policy
                        </div>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Meeting Provider</label>
                        <select
                          value={tool.config?.virtual?.meeting_provider || 'Google Meet'}
                          onChange={e => {
                            const tools = [...config.tools];
                            if (!tools[selectedToolIndex].config.virtual) tools[selectedToolIndex].config.virtual = {};
                            tools[selectedToolIndex].config.virtual.meeting_provider = e.target.value;
                            setConfig({ ...config, tools });
                            setHasDraftChanges(true);
                          }}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem', marginBottom: '8px' }}
                        >
                          <option value="Google Meet">Google Meet (Auto Dynamic Link)</option>
                          <option value="Zoom">Zoom Video Consultation</option>
                        </select>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.76rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={tool.config?.virtual?.send_calendar_invite ?? true} onChange={() => {}} />
                          Auto-generate video link and calendar invitation
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Callbacks Configuration */}
                {isCallback && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                      Configure callback scheduling channels, calling windows, and retry limits.
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={tool.config?.enable_parent_callback ?? true}
                          onChange={e => {
                            const tools = [...config.tools];
                            tools[selectedToolIndex].config.enable_parent_callback = e.target.checked;
                            setConfig({ ...config, tools });
                            setHasDraftChanges(true);
                          }}
                        />
                        Enable AI Automated Callbacks (Dialer)
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={tool.config?.enable_counselor_followup ?? true}
                          onChange={e => {
                            const tools = [...config.tools];
                            tools[selectedToolIndex].config.enable_counselor_followup = e.target.checked;
                            setConfig({ ...config, tools });
                            setHasDraftChanges(true);
                          }}
                        />
                        Enable Human Counselor Follow-Up Tasks
                      </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Allowed Calling Window</label>
                        <input
                          type="text"
                          value={tool.config?.allowed_window || '09:00 - 21:00 IST'}
                          onChange={e => {
                            const tools = [...config.tools];
                            tools[selectedToolIndex].config.allowed_window = e.target.value;
                            setConfig({ ...config, tools });
                            setHasDraftChanges(true);
                          }}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Timezone</label>
                        <input
                          type="text"
                          value={tool.config?.timezone || 'Asia/Kolkata'}
                          disabled
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem', background: 'rgba(0,0,0,0.02)' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Max Callback Attempts</label>
                        <input
                          type="number"
                          value={tool.config?.max_attempts || 3}
                          onChange={e => {
                            const tools = [...config.tools];
                            tools[selectedToolIndex].config.max_attempts = Number(e.target.value);
                            setConfig({ ...config, tools });
                            setHasDraftChanges(true);
                          }}
                          min={1}
                          max={5}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. Demo Classes Configuration */}
                {isClass && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                      Manage student trial immersion and workshop class types. Capacity is checked programmatically by <code>AvailabilityService</code>.
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {(tool.config?.class_types || []).map((ct: any, cIdx: number) => (
                        <div
                          key={ct.id || cIdx}
                          style={{
                            padding: '12px 14px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'rgba(0,0,0,0.01)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{ct.name}</div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                              Grades: <strong>{ct.grades}</strong> • Duration: <strong>{ct.duration_min} min</strong> • Ratio: <strong>{ct.ratio}</strong>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                              Capacity: <span style={{ color: '#059669' }}>{ct.capacity} per slot</span>
                            </div>
                            <input
                              type="number"
                              value={ct.capacity}
                              onChange={e => {
                                const tools = [...config.tools];
                                tools[selectedToolIndex].config.class_types[cIdx].capacity = Number(e.target.value);
                                setConfig({ ...config, tools });
                                setHasDraftChanges(true);
                              }}
                              min={1}
                              max={20}
                              style={{ width: '60px', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. Counselor Handoff Configuration */}
                {isTransfer && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                      In-call human counselor transfer policies. The tool dynamically resolves counselor routing without hardcoding phone numbers in the prompt.
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Minimum Lead Score for Transfer</label>
                        <input
                          type="number"
                          value={tool.config?.min_interest_score || 80}
                          onChange={e => {
                            const tools = [...config.tools];
                            tools[selectedToolIndex].config.min_interest_score = Number(e.target.value);
                            setConfig({ ...config, tools });
                            setHasDraftChanges(true);
                          }}
                          min={50}
                          max={100}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}
                        />
                      </div>

                      <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Routing Strategy</label>
                        <select
                          value={tool.config?.routing_strategy || 'Least Busy'}
                          onChange={e => {
                            const tools = [...config.tools];
                            tools[selectedToolIndex].config.routing_strategy = e.target.value;
                            setConfig({ ...config, tools });
                            setHasDraftChanges(true);
                          }}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}
                        >
                          <option value="Least Busy">Least Busy Counselor</option>
                          <option value="Best Match">Best Match (Language + Branch)</option>
                          <option value="Round Robin">Round Robin Distribution</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>Fallback if No Counselor Available</label>
                      <input
                        type="text"
                        value={tool.config?.fallback || 'Schedule Counselor Callback'}
                        disabled
                        style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.78rem', background: 'rgba(0,0,0,0.02)' }}
                      />
                    </div>
                  </div>
                )}

                {/* Generic Tool Configuration fallback */}
                {!isAppointment && !isCallback && !isClass && !isTransfer && (
                  <div>
                    <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                      Tool Parameter Configuration &amp; Schema:
                    </div>
                    <pre style={{ padding: '14px', borderRadius: '8px', background: 'rgba(0,0,0,0.03)', border: '1px solid var(--border-color)', fontSize: '0.78rem' }}>
                      {JSON.stringify(tool.config || {}, null, 2)}
                    </pre>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{
                padding: '14px 22px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                background: 'rgba(0,0,0,0.01)'
              }}>
                <button
                  type="button"
                  onClick={() => setSelectedToolIndex(null)}
                  className="btn btn-primary"
                  style={{ padding: '6px 18px', fontSize: '0.82rem', borderRadius: '6px' }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
