import React from 'react';
import {
  X, GitCommit, ArrowRight, RotateCcw, Check, Sparkles, AlertCircle,
  Code, Sliders, Shield, Zap, CheckCircle2
} from 'lucide-react';

interface VersionSnapshot {
  id: string;
  version_number: number;
  status: string;
  is_current?: boolean;
  created_by: string;
  change_summary?: string;
  published_at?: string;
  config?: any;
}

interface VersionDiffViewerProps {
  versionA: VersionSnapshot;
  versionB: VersionSnapshot;
  onClose: () => void;
  onRestore?: (versionId: string) => void;
}

export default function VersionDiffViewer({
  versionA,
  versionB,
  onClose,
  onRestore
}: VersionDiffViewerProps) {
  const promptA = versionA.config?.prompt?.system_prompt || '';
  const promptB = versionB.config?.prompt?.system_prompt || '';

  const linesA = promptA.split('\n');
  const linesB = promptB.split('\n');

  // Simple line diff comparator
  const maxLines = Math.max(linesA.length, linesB.length);

  // Tools diff
  const toolsA = versionA.config?.tools?.map((t: any) => t.name) || [];
  const toolsB = versionB.config?.tools?.map((t: any) => t.name) || [];

  const weightsA = versionA.config?.qualification?.scoring_weights || {};
  const weightsB = versionB.config?.qualification?.scoring_weights || {};

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(8px)',
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
        boxShadow: 'var(--shadow-2xl, 0 25px 50px -12px rgba(0,0,0,0.25))',
        width: '100%',
        maxWidth: '1100px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 24px',
          borderBottom: '1px solid var(--border-color)',
          background: 'var(--glass-bg, rgba(255,255,255,0.8))'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <GitCommit size={18} color="var(--accent-primary, #10b981)" />
              Compare Agent Versions: V{versionA.version_number} vs V{versionB.version_number}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Inspect differences in system prompt, qualification scoring weights, and tools configuration.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {onRestore && (
              <button
                type="button"
                onClick={() => onRestore(versionA.id)}
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '6px 14px', borderRadius: '8px' }}
              >
                <RotateCcw size={14} style={{ marginRight: '6px' }} />
                Restore V{versionA.version_number} as Draft
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary btn-icon"
              style={{ borderRadius: '8px', padding: '6px' }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Content */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Metadata Comparison Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Version A Card */}
            <div style={{
              padding: '14px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: 'rgba(0,0,0,0.02)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  Version {versionA.version_number}
                </span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: versionA.is_current ? 'rgba(16,185,129,0.1)' : 'rgba(0,0,0,0.05)',
                  color: versionA.is_current ? '#059669' : 'var(--text-muted)'
                }}>
                  {versionA.is_current ? '● Current Live' : versionA.status}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <strong>Reason:</strong> {versionA.change_summary || 'No summary'}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Published: {versionA.published_at ? new Date(versionA.published_at).toLocaleString() : 'N/A'} by {versionA.created_by}
              </div>
            </div>

            {/* Version B Card */}
            <div style={{
              padding: '14px',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              background: 'rgba(0,0,0,0.02)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                  Version {versionB.version_number}
                </span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: versionB.is_current ? 'rgba(16,185,129,0.1)' : 'rgba(0,0,0,0.05)',
                  color: versionB.is_current ? '#059669' : 'var(--text-muted)'
                }}>
                  {versionB.is_current ? '● Current Live' : versionB.status}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                <strong>Reason:</strong> {versionB.change_summary || 'No summary'}
              </div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Published: {versionB.published_at ? new Date(versionB.published_at).toLocaleString() : 'N/A'} by {versionB.created_by}
              </div>
            </div>
          </div>

          {/* Prompt Diff Section */}
          <div>
            <h4 style={{ margin: '0 0 8px', fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Code size={15} color="var(--accent-primary, #10b981)" />
              System Prompt Diff
            </h4>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              border: '1px solid var(--border-color)',
              borderRadius: '10px',
              overflow: 'hidden',
              background: 'rgba(0,0,0,0.01)',
              maxHeight: '340px',
              overflowY: 'auto'
            }}>
              {/* Left Version A Prompt */}
              <div style={{ padding: '12px', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: '1.5', borderRight: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>V{versionA.version_number} PROMPT:</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                  {promptA || '(Empty)'}
                </pre>
              </div>

              {/* Right Version B Prompt */}
              <div style={{ padding: '12px', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: '1.5' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>V{versionB.version_number} PROMPT:</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                  {promptB || '(Empty)'}
                </pre>
              </div>
            </div>
          </div>

          {/* Qualification Weights Comparison */}
          <div>
            <h4 style={{ margin: '0 0 8px', fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Sliders size={15} color="var(--accent-primary, #10b981)" />
              Qualification Weights Comparison
            </h4>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '8px'
            }}>
              {Object.keys({ ...weightsA, ...weightsB }).map(key => {
                const valA = weightsA[key] ?? 0;
                const valB = weightsB[key] ?? 0;
                const changed = valA !== valB;
                return (
                  <div
                    key={key}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: `1px solid ${changed ? 'var(--accent-primary, #10b981)' : 'var(--border-color)'}`,
                      background: changed ? 'rgba(16,185,129,0.06)' : 'rgba(0,0,0,0.02)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.78rem'
                    }}
                  >
                    <span style={{ textTransform: 'capitalize', color: 'var(--text-secondary)' }}>
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontWeight: 700, color: changed ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                      {valA}% &rarr; {valB}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '12px 24px',
          borderTop: '1px solid var(--border-color)',
          background: 'rgba(0,0,0,0.02)'
        }}>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '6px 18px', borderRadius: '8px' }}
          >
            Close Diff View
          </button>
        </div>
      </div>
    </div>
  );
}
