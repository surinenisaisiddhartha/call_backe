import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import {
  Activity, Search, Filter, RefreshCw, CheckCircle2, XCircle, AlertCircle,
  Copy, Check, Eye, X, Terminal, Radio, Clock, Code, ArrowLeft
} from 'lucide-react';

interface LogItem {
  id: string;
  provider: string;
  event_type: string;
  provider_event_id?: string;
  provider_call_id?: string;
  signature_verified: boolean;
  received_at: string;
  processing_status: 'processed' | 'ignored' | 'error';
  payload: any;
  error_message?: string;
}

interface LogsProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function Logs({ showToast }: LogsProps) {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerFilter, setProviderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPayload, setSelectedPayload] = useState<LogItem | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await api.get('/providers/logs', {
        params: {
          provider: providerFilter,
          status: statusFilter,
          search: searchQuery || undefined,
          limit: 60
        }
      });
      setLogs(res.data);
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to fetch logs'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [providerFilter, statusFilter]);

  const handleCopyPayload = () => {
    if (!selectedPayload) return;
    navigator.clipboard.writeText(JSON.stringify(selectedPayload.payload, null, 2));
    setCopied(true);
    showToast('Copied JSON payload to clipboard', 'success');
    setTimeout(() => setCopied(false), 2000);
  };

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
        <span style={{ color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600 }}>Webhook &amp; Logs</span>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Operational Activity &amp; Webhook Logs
            </h1>
            <span style={{
              background: 'rgba(6,182,212,0.12)',
              color: 'var(--accent-cyan)',
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '0.78rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <Terminal size={13} />
              Raw Audit Trail
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px', marginBottom: 0 }}>
            Inspect incoming webhook payloads, call dispatch events, and signature verifications across all voice providers.
          </p>
        </div>

        <button
          className="btn-primary"
          onClick={fetchLogs}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 15px', fontSize: '0.85rem' }}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh Stream
        </button>
      </div>

      {/* Filters Bar */}
      <div className="card" style={{
        padding: '16px 20px',
        borderRadius: '14px',
        marginBottom: '22px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '14px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '280px' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: '380px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search call ID, event type, or payload..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchLogs()}
              className="input-field"
              style={{ width: '100%', paddingLeft: '36px' }}
            />
          </div>
          <button className="btn-secondary" onClick={fetchLogs} style={{ padding: '8px 14px', fontSize: '0.82rem' }}>
            Search
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Provider:</span>
            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value)}
              className="input-field"
              style={{ padding: '6px 10px', fontSize: '0.82rem' }}
            >
              <option value="all">All Providers</option>
              <option value="retell">Retell AI</option>
              <option value="omnidimension">OmniDimension AI</option>
              <option value="bolna">Bolna AI</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input-field"
              style={{ padding: '6px 10px', fontSize: '0.82rem' }}
            >
              <option value="all">All Statuses</option>
              <option value="processed">Processed (200)</option>
              <option value="error">Errors (500)</option>
              <option value="ignored">Ignored</option>
            </select>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="card" style={{ borderRadius: '16px', overflow: 'hidden', padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 16px' }}>Timestamp</th>
                <th style={{ padding: '12px 16px' }}>Provider</th>
                <th style={{ padding: '12px 16px' }}>Event Type</th>
                <th style={{ padding: '12px 16px' }}>Call ID</th>
                <th style={{ padding: '12px 16px' }}>Signature</th>
                <th style={{ padding: '12px 16px' }}>Status</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No webhook logs found matching the filter criteria.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                      {log.received_at ? new Date(log.received_at).toLocaleTimeString() : 'Just now'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        background: log.provider === 'retell' ? 'rgba(16,185,129,0.12)' : (log.provider === 'omnidimension' ? 'rgba(6,182,212,0.12)' : 'rgba(245,158,11,0.12)'),
                        color: log.provider === 'retell' ? 'var(--accent-primary)' : (log.provider === 'omnidimension' ? 'var(--accent-cyan)' : 'var(--accent-warning)')
                      }}>
                        {log.provider === 'retell' ? 'Retell AI' : (log.provider === 'omnidimension' ? 'OmniDimension' : 'Bolna AI')}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {log.event_type}
                    </td>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {log.provider_call_id || 'N/A'}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ color: log.signature_verified ? 'var(--accent-success)' : 'var(--accent-error)', fontSize: '0.75rem', fontWeight: 600 }}>
                        {log.signature_verified ? '✔ Verified' : '✗ Unverified'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        background: log.processing_status === 'processed' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                        color: log.processing_status === 'processed' ? 'var(--accent-success)' : 'var(--accent-error)'
                      }}>
                        {log.processing_status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        className="btn-secondary"
                        onClick={() => setSelectedPayload(log)}
                        style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <Eye size={13} /> View JSON
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* JSON Payload Viewer Modal */}
      {selectedPayload && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.65)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="card animate-scale-in" style={{
            maxWidth: '680px',
            width: '100%',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            padding: '24px',
            borderRadius: '16px',
            background: 'var(--bg-secondary)',
            boxShadow: 'var(--shadow-lg)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Code size={20} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Payload Inspector — {selectedPayload.event_type}
                </h3>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn-secondary"
                  onClick={handleCopyPayload}
                  style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                >
                  {copied ? <Check size={13} color="var(--accent-success)" /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={() => setSelectedPayload(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            <div style={{
              background: '#0d1117',
              color: '#c9d1d9',
              padding: '16px',
              borderRadius: '10px',
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: '0.8rem',
              overflowY: 'auto',
              flex: 1,
              lineHeight: 1.5
            }}>
              <pre style={{ margin: 0 }}>
                {JSON.stringify(selectedPayload.payload, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
