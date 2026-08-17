import React, { useState, useRef, useEffect } from 'react';
import {
  Code, Copy, Check, RotateCcw, Search, Eye, Sparkles,
  HelpCircle, ChevronDown, CheckCircle2, AlertCircle, ArrowRight
} from 'lucide-react';

interface PromptVariable {
  tag: string;
  label: string;
  example: string;
  desc: string;
}

interface PromptEditorProps {
  value: string;
  onChange: (val: string) => void;
  variables: PromptVariable[];
  onResetTemplate?: () => void;
  onPreview?: () => void;
  disabled?: boolean;
}

export default function PromptEditor({
  value,
  onChange,
  variables,
  onResetTemplate,
  onPreview,
  disabled = false
}: PromptEditorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showVarDropdown, setShowVarDropdown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<string[]>([value]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        showVarDropdown &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        dropdownButtonRef.current &&
        !dropdownButtonRef.current.contains(e.target as Node)
      ) {
        setShowVarDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showVarDropdown]);

  // Keep history for undo/redo
  const handleTextChange = (newVal: string) => {
    onChange(newVal);
    // Push to history with debounce
    if (newVal !== history[historyIndex]) {
      const nextHist = history.slice(0, historyIndex + 1);
      nextHist.push(newVal);
      if (nextHist.length > 50) nextHist.shift();
      setHistory(nextHist);
      setHistoryIndex(nextHist.length - 1);
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      onChange(prev);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      onChange(next);
    }
  };

  const handleInsertVariable = (tag: string) => {
    const el = textareaRef.current;
    if (!el) {
      handleTextChange(value + ' ' + tag);
      setShowVarDropdown(false);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const updated = value.substring(0, start) + tag + value.substring(end);
    handleTextChange(updated);
    setShowVarDropdown(false);
    setTimeout(() => {
      el.focus();
      const newPos = start + tag.length;
      el.setSelectionRange(newPos, newPos);
    }, 50);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFindReplace = () => {
    if (!searchTerm) return;
    const updated = value.replaceAll(searchTerm, replaceTerm);
    handleTextChange(updated);
  };

  // Count variables present in prompt
  const detectedVarCount = variables.filter(v => value.includes(v.tag)).length;
  const lineCount = value.split('\n').length;
  const charCount = value.length;
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      borderRadius: '12px',
      border: '1px solid var(--border-color)',
      background: 'var(--bg-card)',
      boxShadow: 'var(--shadow-sm)',
      overflow: 'visible'
    }}>
      {/* Editor Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        borderTopLeftRadius: '12px',
        borderTopRightRadius: '12px',
        flexWrap: 'wrap',
        gap: '8px'
      }}>
        {/* Left Toolbar Items */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Code size={16} color="var(--accent-primary, #10b981)" />
            SYSTEM PROMPT
          </span>

          <div style={{ width: '1px', height: '18px', background: 'var(--border-color)', margin: '0 4px' }} />

          {/* Undo / Redo */}
          <button
            type="button"
            onClick={handleUndo}
            disabled={historyIndex <= 0 || disabled}
            className="btn btn-secondary btn-icon"
            style={{ padding: '4px 8px', fontSize: '0.75rem', borderRadius: '6px' }}
            title="Undo (Ctrl+Z)"
          >
            ↩ Undo
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1 || disabled}
            className="btn btn-secondary btn-icon"
            style={{ padding: '4px 8px', fontSize: '0.75rem', borderRadius: '6px' }}
            title="Redo (Ctrl+Y)"
          >
            ↪ Redo
          </button>

          {/* Find & Replace Toggle */}
          <button
            type="button"
            onClick={() => setShowSearch(prev => !prev)}
            className="btn btn-secondary"
            style={{
              padding: '4px 10px',
              fontSize: '0.75rem',
              borderRadius: '6px',
              background: showSearch ? 'rgba(16,185,129,0.1)' : undefined,
              borderColor: showSearch ? 'var(--accent-primary)' : undefined,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Search size={13} />
            Find &amp; Replace
          </button>
        </div>

        {/* Right Toolbar Items */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Insert Variable Dropdown */}
          <div ref={dropdownButtonRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setShowVarDropdown(prev => !prev)}
              disabled={disabled}
              className="btn btn-primary"
              style={{
                padding: '5px 12px',
                fontSize: '0.78rem',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
              }}
            >
              <Sparkles size={14} />
              Insert Variable
              <ChevronDown size={14} />
            </button>

            {showVarDropdown && (
              <div
                ref={dropdownRef}
                onWheel={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '6px',
                  width: '330px',
                  maxHeight: '340px',
                  overflowY: 'auto',
                  overscrollBehavior: 'contain',
                  WebkitOverflowScrolling: 'touch',
                  background: 'var(--bg-secondary, #ffffff)',
                  backgroundColor: 'var(--bg-secondary, #ffffff)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  boxShadow: '0 16px 38px rgba(0,0,0,0.22)',
                  zIndex: 99999,
                  padding: '8px',
                  opacity: 1
                }}
              >
                <div style={{
                  padding: '6px 8px 8px',
                  fontSize: '0.74rem',
                  fontWeight: 800,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid var(--border-subtle, rgba(0,0,0,0.06))',
                  marginBottom: '4px'
                }}>
                  Supported Prompt Variables
                </div>
                {variables.map(v => (
                  <div
                    key={v.tag}
                    onClick={() => handleInsertVariable(v.tag)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                      transition: 'all 0.15s ease',
                      backgroundColor: 'transparent'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.backgroundColor = 'rgba(16,185,129,0.1)';
                      e.currentTarget.style.transform = 'translateX(2px)';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.transform = 'none';
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <code style={{ color: 'var(--accent-primary, #059669)', fontWeight: 800, fontSize: '0.82rem', background: 'rgba(16,185,129,0.08)', padding: '2px 6px', borderRadius: '4px' }}>
                        {v.tag}
                      </code>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>{v.label}</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{v.desc}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reset to Template */}
          {onResetTemplate && (
            <button
              type="button"
              onClick={onResetTemplate}
              disabled={disabled}
              className="btn btn-secondary"
              style={{ padding: '5px 10px', fontSize: '0.78rem', borderRadius: '6px' }}
              title="Reset prompt to canonical admissions template"
            >
              <RotateCcw size={13} style={{ marginRight: '4px' }} />
              Reset Template
            </button>
          )}

          {/* Copy Prompt */}
          <button
            type="button"
            onClick={handleCopy}
            className="btn btn-secondary btn-icon"
            style={{ padding: '5px 8px', borderRadius: '6px' }}
            title="Copy Prompt"
          >
            {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      {/* Find & Replace Bar (Collapsible) */}
      {showSearch && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          background: 'rgba(16,185,129,0.04)',
          borderBottom: '1px solid var(--border-color)',
          fontSize: '0.8rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Find:</span>
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search text..."
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                fontSize: '0.8rem',
                flex: 1
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Replace:</span>
            <input
              type="text"
              value={replaceTerm}
              onChange={e => setReplaceTerm(e.target.value)}
              placeholder="Replacement text..."
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                fontSize: '0.8rem',
                flex: 1
              }}
            />
          </div>
          <button
            type="button"
            onClick={handleFindReplace}
            className="btn btn-primary"
            style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '4px' }}
          >
            Replace All
          </button>
        </div>
      )}

      {/* Main Text Editor Body with Line Numbers */}
      <div style={{
        position: 'relative',
        display: 'flex',
        minHeight: '380px',
        maxHeight: '600px',
        overflow: 'hidden',
        borderBottomLeftRadius: '12px',
        borderBottomRightRadius: '12px'
      }}>
        {/* Line Numbers Column */}
        <div style={{
          width: '44px',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          padding: '12px 6px',
          fontFamily: 'monospace',
          fontSize: '0.82rem',
          lineHeight: '1.5',
          color: 'var(--text-muted)',
          textAlign: 'right',
          userSelect: 'none',
          overflowY: 'hidden'
        }}>
          {Array.from({ length: Math.min(lineCount, 500) }).map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* Text Area */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => handleTextChange(e.target.value)}
          disabled={disabled}
          placeholder="Write the AI agent system prompt instructions..."
          style={{
            flex: 1,
            padding: '12px 16px',
            border: 'none',
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'Consolas, Menlo, Monaco, "Courier New", monospace',
            fontSize: '0.86rem',
            lineHeight: '1.5',
            color: 'var(--text-primary)',
            background: 'transparent',
            minHeight: '380px'
          }}
          spellCheck={false}
        />
      </div>

      {/* Editor Status Footer */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 16px',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
        fontSize: '0.76rem',
        color: 'var(--text-muted)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span><strong>{lineCount}</strong> lines</span>
          <span><strong>{wordCount}</strong> words</span>
          <span><strong>{charCount.toLocaleString()}</strong> characters</span>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            color: detectedVarCount > 0 ? 'var(--accent-primary, #10b981)' : 'inherit',
            fontWeight: 600
          }}>
            <Sparkles size={12} />
            {detectedVarCount} dynamic variables detected
          </span>
        </div>

        {onPreview && (
          <button
            type="button"
            onClick={onPreview}
            className="btn btn-secondary"
            style={{
              padding: '2px 10px',
              fontSize: '0.74rem',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Eye size={12} />
            Preview with Sample Data
          </button>
        )}
      </div>
    </div>
  );
}
