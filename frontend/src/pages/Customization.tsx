import React, { useEffect, useState, useRef } from 'react';
import api, { getErrorMessage } from '../api';
import {
  Palette, Sparkles, Building, Swords, Plus, Trash2, Save,
  CheckCircle2, Sun, Moon, Eye, Image as ImageIcon, Shield, Award,
  BookOpen, ArrowLeft, X, Code, Copy, Check, RotateCcw, Zap,
  Sliders, User, MessageSquare, AlertCircle, FileText, ChevronDown
} from 'lucide-react';

interface CompetitorItem {
  id: string;
  competitor_name: string;
  key_advantages: string;
  curriculum_comparison?: string;
  ratio_comparison?: string;
  facilities_comparison?: string;
  objection_scripts?: string;
}

interface PromptVariable {
  tag: string;
  label: string;
  example: string;
  desc: string;
}

interface PromptTemplate {
  id: string;
  name: string;
  persona: string;
  role: string;
  tone: string;
  desc: string;
}

interface CustomizationProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  currentTheme: string;
  onThemeChange: (theme: string) => void;
}

export default function Customization({ showToast, currentTheme, onThemeChange }: CustomizationProps) {
  const [activeTab, setActiveTab] = useState<'prompt' | 'competitors' | 'theme'>('prompt');
  
  // ── Prompt Studio State ──────────────────────────────────────────────────
  const [promptText, setPromptText] = useState<string>('');
  const [originalPromptText, setOriginalPromptText] = useState<string>('');
  const [loadingPrompt, setLoadingPrompt] = useState<boolean>(true);
  const [savingPrompt, setSavingPrompt] = useState<boolean>(false);
  const [resettingPrompt, setResettingPrompt] = useState<boolean>(false);
  const [promptVariables, setPromptVariables] = useState<PromptVariable[]>([]);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [isSchoolCustom, setIsSchoolCustom] = useState<boolean>(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
  const [schoolsList, setSchoolsList] = useState<any[]>([]);

  // Persona settings
  const [personaName, setPersonaName] = useState<string>('Maya');
  const [personaRole, setPersonaRole] = useState<string>('Senior Admissions Outreach Specialist');
  const [personaTone, setPersonaTone] = useState<string>('Warm, unhurried, empathetic, conversational');

  // Preview & Testing state
  const [previewMode, setPreviewMode] = useState<'edit' | 'preview' | 'split'>('edit');
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [sampleData, setSampleData] = useState({
    caller_name: 'Mrs. Priya Sharma',
    student_name: 'Aarav Sharma',
    grade_applying: 'Grade 5 (Primary Years)',
    academic_year: '2026-2027',
    school_name: 'The Shri Ram Academy',
    location: 'Gachibowli, Hyderabad',
    contact_phone: '+91 75698 91111',
    notes: 'Inquired on website about IB PYP curriculum and robotics lab.'
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Competitor State ─────────────────────────────────────────────────────
  const [competitors, setCompetitors] = useState<CompetitorItem[]>([]);
  const [loadingCompetitors, setLoadingCompetitors] = useState(false);
  const [customPrimaryColor, setCustomPrimaryColor] = useState('#6C5CE7');
  const [customSecondaryColor, setCustomSecondaryColor] = useState('#5846E0');
  const [showAddCompetitorModal, setShowAddCompetitorModal] = useState(false);
  const [newCompetitor, setNewCompetitor] = useState({
    competitor_name: '',
    key_advantages: '',
    curriculum_comparison: '',
    ratio_comparison: '1:8 vs 1:30',
    facilities_comparison: '',
    objection_scripts: ''
  });

  const themes = [
    { id: 'light', name: 'Response AI Light', desc: 'Clean white workspace, subtle slate borders, and soft emerald accents', previewColor: '#10B981', bg: '#F8F9FC' },
    { id: 'dark', name: 'Dark Slate Studio', desc: 'Deep obsidian surfaces, glass cards, and electric indigo glow', previewColor: '#6366F1', bg: '#090D16' },
    { id: 'emerald', name: 'Emerald Executive', desc: 'Modern CRM porcelain with vibrant mint & emerald accents', previewColor: '#10B981', bg: '#F8FAFC' },
    { id: 'sapphire', name: 'Sapphire Pro', desc: 'Executive navy blue and high-contrast sapphire accents', previewColor: '#2563EB', bg: '#0B1329' },
    { id: 'amber', name: 'Sunset Amber', desc: 'Warm stone palette with terracotta and amber accents', previewColor: '#EA580C', bg: '#FAF8F5' }
  ];

  // Fetch prompt data
  const fetchPromptData = async (schoolId?: string) => {
    setLoadingPrompt(true);
    try {
      const url = schoolId ? `/agent/prompt?school_id=${schoolId}` : '/agent/prompt';
      const res = await api.get(url);
      if (res.data) {
        setPromptText(res.data.prompt || '');
        setOriginalPromptText(res.data.prompt || '');
        setIsSchoolCustom(Boolean(res.data.is_school_custom));
        if (res.data.variables) setPromptVariables(res.data.variables);
        if (res.data.templates) setPromptTemplates(res.data.templates);
        if (res.data.persona) {
          setPersonaName(res.data.persona.name || 'Maya');
          setPersonaRole(res.data.persona.role || 'Senior Admissions Outreach Specialist');
          setPersonaTone(res.data.persona.tone || 'Warm, unhurried, empathetic, conversational');
        }
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to load agent prompt'), 'error');
    } finally {
      setLoadingPrompt(false);
    }
  };

  const fetchCompetitors = async () => {
    setLoadingCompetitors(true);
    try {
      const res = await api.get('/providers/comparisons');
      setCompetitors(res.data);
    } catch (err) {
      console.warn('Competitor fetch error:', err);
    } finally {
      setLoadingCompetitors(false);
    }
  };

  const fetchSchools = async () => {
    try {
      const res = await api.get('/schools');
      if (Array.isArray(res.data)) {
        setSchoolsList(res.data);
      }
    } catch {}
  };

  useEffect(() => {
    fetchPromptData();
    fetchCompetitors();
    fetchSchools();
    const savedPrimary = localStorage.getItem('custom_primary_color');
    if (savedPrimary) setCustomPrimaryColor(savedPrimary);
  }, []);

  const handleSchoolChange = (schoolId: string) => {
    setSelectedSchoolId(schoolId);
    fetchPromptData(schoolId || undefined);
  };

  const handleInsertVariable = (tag: string) => {
    if (!textareaRef.current) {
      setPromptText(prev => prev + ' ' + tag);
      return;
    }
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const text = promptText;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);
    setPromptText(before + tag + after);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start + tag.length, start + tag.length);
      }
    }, 50);
    showToast(`Inserted variable ${tag}`, 'success');
  };

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    try {
      const res = await api.put('/agent/prompt', {
        prompt: promptText,
        school_id: selectedSchoolId || undefined,
        persona_name: personaName,
        persona_role: personaRole,
        persona_tone: personaTone,
        auto_sync_provider: true
      });
      setOriginalPromptText(promptText);
      showToast(res.data?.message || 'Agent prompt saved successfully!', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save prompt'), 'error');
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleResetPrompt = async () => {
    if (!window.confirm('Are you sure you want to reset to the standard default prompt? Any custom unsaved changes will be replaced.')) {
      return;
    }
    setResettingPrompt(true);
    try {
      const res = await api.post(`/agent/prompt/reset${selectedSchoolId ? `?school_id=${selectedSchoolId}` : ''}`);
      if (res.data?.prompt) {
        setPromptText(res.data.prompt);
        setOriginalPromptText(res.data.prompt);
      }
      showToast('Reset prompt to standard default template', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to reset prompt'), 'error');
    } finally {
      setResettingPrompt(false);
    }
  };

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(promptText);
    setCopiedPrompt(true);
    showToast('Copied prompt to clipboard', 'success');
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  // Render dynamic preview
  const getRenderedPreview = () => {
    return promptText
      .replace(/{{caller_name}}/g, sampleData.caller_name)
      .replace(/{{student_name}}/g, sampleData.student_name)
      .replace(/{{grade_applying}}/g, sampleData.grade_applying)
      .replace(/{{academic_year}}/g, sampleData.academic_year)
      .replace(/{{school_name}}/g, sampleData.school_name)
      .replace(/{{location}}/g, sampleData.location)
      .replace(/{{contact_phone}}/g, sampleData.contact_phone)
      .replace(/{{notes}}/g, sampleData.notes)
      .replace(/{{current_datetime}}/g, '2026-08-14T19:30:00+05:30')
      .replace(/{{booking_link}}/g, 'https://cal.com/tsra-admissions/campus-tour');
  };

  const handleApplyCustomColor = () => {
    document.documentElement.style.setProperty('--accent-primary', customPrimaryColor);
    document.documentElement.style.setProperty('--accent-secondary', customSecondaryColor);
    localStorage.setItem('custom_primary_color', customPrimaryColor);
    localStorage.setItem('custom_secondary_color', customSecondaryColor);
    showToast('Applied custom brand accent colors!', 'success');
  };

  const handleCreateCompetitor = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/providers/comparisons', newCompetitor);
      showToast(`Added competitor battlecard for ${newCompetitor.competitor_name}`, 'success');
      setShowAddCompetitorModal(false);
      setNewCompetitor({
        competitor_name: '',
        key_advantages: '',
        curriculum_comparison: '',
        ratio_comparison: '1:8 vs 1:30',
        facilities_comparison: '',
        objection_scripts: ''
      });
      await fetchCompetitors();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save competitor comparison'), 'error');
    }
  };

  const handleDeleteCompetitor = async (id: string) => {
    try {
      await api.delete(`/providers/comparisons/${id}`);
      showToast('Deleted competitor battlecard', 'success');
      setCompetitors(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to delete competitor'), 'error');
    }
  };

  const isDirty = promptText !== originalPromptText;

  return (
    <div className="page-container animate-fade-in" style={{ padding: '28px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Back Navigation Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
        <button
          onClick={() => window.history.length > 1 ? window.history.back() : (window.location.hash = '#dashboard')}
          className="btn btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px' }}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>/</span>
        <a href="#dashboard" style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textDecoration: 'none' }}>Dashboard</a>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600 }}>AI Agent Customization &amp; Prompt Studio</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              AI Agent Prompt &amp; Brand Studio
            </h1>
            <span style={{
              background: 'rgba(16,185,129,0.12)',
              color: 'var(--accent-primary)',
              border: '1px solid rgba(16,185,129,0.25)',
              padding: '3px 10px',
              borderRadius: '20px',
              fontSize: '0.76rem',
              fontWeight: 700
            }}>
              Live Script Engine
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px', marginBottom: 0 }}>
            Configure conversational voice agent prompts, dynamic variables, persona tone, competitor battlecards, and UI theme.
          </p>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '24px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setActiveTab('prompt')}
          style={{
            padding: '10px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'prompt' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeTab === 'prompt' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: 700,
            fontSize: '0.88rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Sparkles size={16} /> AI Agent Prompt &amp; Persona Studio
        </button>

        <button
          onClick={() => setActiveTab('competitors')}
          style={{
            padding: '10px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'competitors' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeTab === 'competitors' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: 700,
            fontSize: '0.88rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Swords size={16} /> Competitor Battlecards &amp; USPs ({competitors.length})
        </button>

        <button
          onClick={() => setActiveTab('theme')}
          style={{
            padding: '10px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'theme' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeTab === 'theme' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: 700,
            fontSize: '0.88rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Palette size={16} /> Color Themes &amp; Branding Accents
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: AI Agent Prompt & Persona Studio                                    */}
      {/* ========================================================================= */}
      {activeTab === 'prompt' && (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Top Control Bar & Context Selector */}
          <div className="card" style={{ padding: '18px 22px', borderRadius: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  Target Institution Context
                </label>
                <select
                  value={selectedSchoolId}
                  onChange={(e) => handleSchoolChange(e.target.value)}
                  className="input-field"
                  style={{ padding: '6px 12px', fontSize: '0.88rem', fontWeight: 600, minWidth: '240px' }}
                >
                  <option value="">🏢 Platform Master Prompt (Global Default)</option>
                  {schoolsList.map(s => (
                    <option key={s.id} value={s.id}>
                      🏫 {s.name} {s.custom_prompt ? '(Custom Script)' : '(Default)'}
                    </option>
                  ))}
                </select>
              </div>

              {isSchoolCustom && (
                <span style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent-primary)', padding: '4px 10px', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 700, alignSelf: 'flex-end', marginBottom: '2px' }}>
                  Custom School Override Active
                </span>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCopyPrompt}
                style={{ padding: '8px 12px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {copiedPrompt ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                {copiedPrompt ? 'Copied' : 'Copy Prompt'}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleResetPrompt}
                disabled={resettingPrompt}
                style={{ padding: '8px 12px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RotateCcw size={14} className={resettingPrompt ? 'animate-spin' : ''} />
                Reset to Default
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSavePrompt}
                disabled={savingPrompt}
                style={{ padding: '8px 16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}
              >
                <Zap size={15} />
                {savingPrompt ? 'Saving & Syncing...' : 'Save & Sync with Provider'}
              </button>
            </div>
          </div>

          {/* Persona & Tone Configuration Header */}
          <div className="card" style={{ padding: '20px', borderRadius: '14px', background: 'var(--bg-tertiary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <User size={18} color="var(--accent-primary)" />
              <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                AI Voice Persona &amp; Tone Settings
              </h3>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Agent Name
                </label>
                <input
                  type="text"
                  value={personaName}
                  onChange={(e) => setPersonaName(e.target.value)}
                  className="input-field"
                  placeholder="e.g. Maya, Rhea, Aarav"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Counselor Role / Title
                </label>
                <input
                  type="text"
                  value={personaRole}
                  onChange={(e) => setPersonaRole(e.target.value)}
                  className="input-field"
                  placeholder="e.g. Senior Admissions Outreach Specialist"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Conversational Speaking Tone
                </label>
                <input
                  type="text"
                  value={personaTone}
                  onChange={(e) => setPersonaTone(e.target.value)}
                  className="input-field"
                  placeholder="e.g. Warm, unhurried, empathetic, conversational"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </div>

          {/* Clickable Variable Tags Bar */}
          <div className="card" style={{ padding: '16px 20px', borderRadius: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Code size={16} color="var(--accent-primary)" />
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Dynamic Lead Variables (Click to Insert into Prompt at Cursor)
                </span>
              </div>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>Interpolated dynamically on every live call</span>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {promptVariables.map(v => (
                <button
                  key={v.tag}
                  type="button"
                  onClick={() => handleInsertVariable(v.tag)}
                  title={`${v.label} (e.g. ${v.example})`}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '8px',
                    fontSize: '0.76rem',
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    background: 'rgba(99,102,241,0.08)',
                    border: '1px solid rgba(99,102,241,0.25)',
                    color: 'var(--accent-primary)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'var(--transition-smooth)'
                  }}
                >
                  <Plus size={12} /> {v.tag}
                </button>
              ))}
            </div>
          </div>

          {/* Main Editor & Live Preview Area */}
          <div style={{ display: 'grid', gridTemplateColumns: previewMode === 'split' ? '1fr 1fr' : '1fr', gap: '20px' }}>
            {/* Left: Code Editor */}
            <div className="card" style={{ padding: '20px', borderRadius: '16px', display: previewMode === 'preview' ? 'none' : 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={17} color="var(--accent-primary)" />
                  <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    System Prompt &amp; Conversational Rules (Markdown)
                  </strong>
                  {isDirty && (
                    <span style={{ fontSize: '0.72rem', background: 'rgba(234,179,8,0.15)', color: 'var(--accent-warning)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>
                      ● Unsaved Changes
                    </span>
                  )}
                </div>

                {/* View Mode Toggle */}
                <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-tertiary)', padding: '3px', borderRadius: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('edit')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: previewMode === 'edit' ? 700 : 500,
                      background: previewMode === 'edit' ? 'var(--bg-card)' : 'transparent',
                      border: 'none',
                      color: previewMode === 'edit' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                  >
                    Editor
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('split')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: previewMode === 'split' ? 700 : 500,
                      background: previewMode === 'split' ? 'var(--bg-card)' : 'transparent',
                      border: 'none',
                      color: previewMode === 'split' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                  >
                    Split View
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('preview')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: previewMode === 'preview' ? 700 : 500,
                      background: previewMode === 'preview' ? 'var(--bg-card)' : 'transparent',
                      border: 'none',
                      color: previewMode === 'preview' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      cursor: 'pointer'
                    }}
                  >
                    Live Preview
                  </button>
                </div>
              </div>

              <textarea
                ref={textareaRef}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                disabled={loadingPrompt}
                placeholder="Enter AI Voice Agent instructions, greeting, objection handling, and conversation rules in Markdown..."
                style={{
                  width: '100%',
                  minHeight: '480px',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  fontSize: '0.85rem',
                  lineHeight: '1.55',
                  padding: '16px',
                  borderRadius: '10px',
                  background: 'var(--bg-tertiary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  resize: 'vertical'
                }}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                <span>Lines: {promptText.split('\n').length} | Words: {promptText.split(/\s+/).filter(Boolean).length} | Characters: {promptText.length}</span>
                <span>Press <strong>Save &amp; Sync</strong> to push updates to active voice agents</span>
              </div>
            </div>

            {/* Right: Live Interpolated Preview */}
            <div className="card" style={{ padding: '20px', borderRadius: '16px', display: previewMode === 'edit' ? 'none' : 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Eye size={17} color="var(--accent-primary)" />
                  <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    Live Interpolated Call Preview
                  </strong>
                </div>

                <span style={{ fontSize: '0.74rem', background: 'rgba(16,185,129,0.12)', color: 'var(--accent-primary)', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                  Rendered with Sample Lead Data
                </span>
              </div>

              <div style={{
                width: '100%',
                minHeight: '480px',
                maxHeight: '560px',
                overflowY: 'auto',
                padding: '16px',
                borderRadius: '10px',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                lineHeight: '1.6',
                border: '1px solid var(--border-color)',
                whiteSpace: 'pre-wrap',
                fontFamily: 'system-ui, -apple-system, sans-serif'
              }}>
                {getRenderedPreview()}
              </div>

              <div style={{ marginTop: '12px', background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.76rem' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Sample Lead Variables Used:</strong>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '6px', marginTop: '6px', color: 'var(--text-muted)' }}>
                  <div>Caller: <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{sampleData.caller_name}</span></div>
                  <div>Student: <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{sampleData.student_name}</span></div>
                  <div>Grade: <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{sampleData.grade_applying}</span></div>
                  <div>School: <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{sampleData.school_name}</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: Competitor Battlecards & USPs                                       */}
      {/* ========================================================================= */}
      {activeTab === 'competitors' && (
        <div className="animate-fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Competitor Comparison Matrix &amp; Objection Battlecards
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px', marginBottom: 0 }}>
                Equip the AI Voice Agent with factual differentiators when parents compare against nearby schools.
              </p>
            </div>

            <button
              className="btn btn-primary"
              onClick={() => setShowAddCompetitorModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
            >
              <Plus size={15} /> Add Competitor Battlecard
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '18px' }}>
            {competitors.length === 0 ? (
              <div className="card" style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)', gridColumn: '1 / -1' }}>
                <Shield size={32} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
                <div>No competitor battlecards configured yet.</div>
                <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>Click "Add Competitor Battlecard" to train the agent on your key school differentiators.</div>
              </div>
            ) : (
              competitors.map((c) => (
                <div key={c.id} className="card hover-lift" style={{ padding: '20px', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Award size={18} color="var(--accent-primary)" />
                      <strong style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>{c.competitor_name}</strong>
                    </div>
                    <button
                      className="btn-icon"
                      onClick={() => handleDeleteCompetitor(c.id)}
                      title="Delete battlecard"
                      style={{ color: 'var(--accent-danger)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.84rem' }}>
                    <div style={{ background: 'rgba(16,185,129,0.08)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(16,185,129,0.2)' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-primary)', display: 'block', marginBottom: '2px' }}>
                        Our Key Advantages
                      </span>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{c.key_advantages}</div>
                    </div>

                    {c.ratio_comparison && (
                      <div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Student-Teacher Ratio:</span>
                        <div style={{ color: 'var(--text-secondary)' }}>{c.ratio_comparison}</div>
                      </div>
                    )}

                    {c.curriculum_comparison && (
                      <div>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Curriculum &amp; Academics:</span>
                        <div style={{ color: 'var(--text-secondary)' }}>{c.curriculum_comparison}</div>
                      </div>
                    )}

                    {c.objection_scripts && (
                      <div style={{ background: 'var(--bg-tertiary)', padding: '8px 10px', borderRadius: '6px' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Agent Objection Handling:</span>
                        <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '2px' }}>"{c.objection_scripts}"</div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: Color Themes & Branding Accents                                     */}
      {/* ========================================================================= */}
      {activeTab === 'theme' && (
        <div className="animate-fade-in">
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '14px' }}>
            Preset Design Systems
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px', marginBottom: '32px' }}>
            {themes.map((t) => {
              const isSelected = currentTheme === t.id;
              return (
                <div
                  key={t.id}
                  onClick={() => onThemeChange(t.id)}
                  className="card hover-lift"
                  style={{
                    padding: '20px',
                    borderRadius: '14px',
                    cursor: 'pointer',
                    border: isSelected ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                    background: 'var(--bg-card)',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: t.previewColor }} />
                      <strong style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{t.name}</strong>
                    </div>
                    {isSelected && <CheckCircle2 size={18} color="var(--accent-primary)" />}
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: 0 }}>
                    {t.desc}
                  </p>
                </div>
              );
            })}
          </div>

          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '14px' }}>
            Custom Brand Accent Overrides
          </h3>
          <div className="card" style={{ padding: '24px', borderRadius: '16px', maxWidth: '640px' }}>
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
              className="btn btn-primary"
              onClick={handleApplyCustomColor}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Save size={15} /> Apply Brand Accents
            </button>
          </div>
        </div>
      )}

      {/* Add Competitor Modal */}
      {showAddCompetitorModal && (
        <div className="app-modal-backdrop">
          <div className="app-modal-dialog" style={{ maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Award size={18} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Add Competitor Battlecard
                </h3>
              </div>
              <button
                className="btn-icon"
                onClick={() => setShowAddCompetitorModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCompetitor} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Competitor School Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Oakridge International / DPS"
                  value={newCompetitor.competitor_name}
                  onChange={(e) => setNewCompetitor(prev => ({ ...prev, competitor_name: e.target.value }))}
                  className="input-field"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Our Key Winning Advantages *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 1:8 ratio, Olympic-sized swimming pool, IB World accreditation"
                  value={newCompetitor.key_advantages}
                  onChange={(e) => setNewCompetitor(prev => ({ ...prev, key_advantages: e.target.value }))}
                  className="input-field"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Student-Teacher Ratio Comparison
                </label>
                <input
                  type="text"
                  placeholder="e.g. 1:8 (Us) vs 1:30 (Competitor)"
                  value={newCompetitor.ratio_comparison}
                  onChange={(e) => setNewCompetitor(prev => ({ ...prev, ratio_comparison: e.target.value }))}
                  className="input-field"
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  Agent Objection Handling Script
                </label>
                <textarea
                  placeholder="e.g. While Oakridge has a great campus, TSRA provides a 1:8 ratio and personalized IB mentorship from Grade 1."
                  value={newCompetitor.objection_scripts}
                  onChange={(e) => setNewCompetitor(prev => ({ ...prev, objection_scripts: e.target.value }))}
                  className="input-field"
                  style={{ width: '100%', minHeight: '80px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddCompetitorModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                >
                  Save Battlecard
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
