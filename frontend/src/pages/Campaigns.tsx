import React, { useEffect, useState, useRef } from 'react';
import api from '../api';
import Pagination from '../components/Pagination';
import {
  BarChart2, Play, RefreshCw, Users, CheckCircle,
  AlertCircle, Calendar, Phone, Clock, FileText, ChevronDown, ChevronRight, Trash2,
  Plus, X, UploadCloud
} from 'lucide-react';

interface BatchStats {
  pending: number;
  calling: number;
  completed: number;
  needs_reschedule: number;
  scheduled: number;
  failed: number;
}

interface Campaign {
  id: string;
  file_name: string;
  uploaded_at: string;
  total_contacts: number;
  uploaded_by: string;
  status: 'idle' | 'running' | 'paused' | 'completed';
  stats: BatchStats;
}

interface CallRecord {
  id: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  outcome: string;
  duration_sec: number | null;
  recording_url: string | null;
  transcript: string | null;
  summary: string | null;
  callback_raw_text: string | null;
  started_at: string | null;
}

interface CampaignsProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onViewContact?: (contactId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#6b7280',
  running: '#6366f1',
  paused: '#f59e0b',
  completed: '#10b981',
};

const OUTCOME_COLORS: Record<string, string> = {
  Answered: '#10b981',
  NoAnswer: '#f59e0b',
  Busy: '#f97316',
  Failed: '#ef4444',
  InProgress: '#6366f1',
  IncompleteHangup: '#f59e0b',
};

function formatDuration(sec: number | null): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const utcIso = (iso.endsWith('Z') || iso.includes('+') || (iso.split('-').length >= 4)) ? iso : `${iso}Z`;
  return new Date(utcIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
}

export default function Campaigns({ showToast, onViewContact }: CampaignsProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, CallRecord[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<string | null>(null);
  const [callingId, setCallingId] = useState<string | null>(null);
  const [expandedTranscript, setExpandedTranscript] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [historyPages, setHistoryPages] = useState<Record<string, number>>({});

  const setHistoryPage = (campaignId: string, page: number) => {
    setHistoryPages(prev => ({ ...prev, [campaignId]: page }));
  };

  // Overall stats and concurrency states
  const [contacts, setContacts] = useState<any[]>([]);
  const [concurrency, setConcurrency] = useState({ current: 0, limit: 20 });

  // Upload modal states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchCampaigns();
    const interval = setInterval(fetchCampaigns, 8000);
    return () => clearInterval(interval);
  }, []);

  const fetchCampaigns = async () => {
    try {
      const res = await api.get('/contacts/batches');
      setCampaigns(res.data);

      const contactsRes = await api.get('/contacts');
      setContacts(contactsRes.data);

      try {
        const concRes = await api.get('/calls/concurrency');
        setConcurrency({
          current: concRes.data.current_concurrency || 0,
          limit: concRes.data.concurrency_limit || 20,
        });
      } catch (e) {
        // Fallback
      }
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch campaigns', err);
      setLoading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processUploadFile(e.target.files[0]);
    }
  };

  const processUploadFile = async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.xlsx') && !selectedFile.name.endsWith('.xls') && !selectedFile.name.endsWith('.csv')) {
      showToast('Please upload an Excel (.xlsx/.xls) or CSV file', 'error');
      return;
    }
    setUploadFile(selectedFile);
    setUploadResult(null);
    showToast(`File ${selectedFile.name} loaded. Click Import to parse.`, 'success');
  };

  const triggerUpload = async () => {
    if (!uploadFile) return;
    setUploadLoading(true);
    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      const res = await api.post('/contacts/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setUploadResult(res.data);
      showToast('File parsed and imported successfully!', 'success');
      setUploadFile(null);
      fetchCampaigns();
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to upload spreadsheet', 'error');
    } finally {
      setUploadLoading(false);
    }
  };

  const startCampaign = async (batchId: string) => {
    setCallingId(batchId);
    try {
      await api.post('/calls/start-campaign', { batchId });
      showToast('Campaign started! Calls are being dialed.', 'success');
      fetchCampaigns();
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Failed to start campaign', 'error');
    } finally {
      setCallingId(null);
    }
  };

  const deleteCampaign = async (batchId: string) => {
    if (!window.confirm("Are you sure you want to delete this campaign and all its contacts and history? This cannot be undone.")) return;
    try {
      await api.delete(`/contacts/batches/${batchId}`);
      showToast('Campaign deleted successfully', 'success');
      fetchCampaigns();
    } catch (err) {
      showToast('Failed to delete campaign', 'error');
    }
  };

  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!historyMap[id]) {
      setLoadingHistory(id);
      try {
        const res = await api.get(`/contacts/batches/${id}/history`);
        setHistoryMap(prev => ({ ...prev, [id]: res.data }));
      } catch {
        showToast('Failed to load call history', 'error');
      } finally {
        setLoadingHistory(null);
      }
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <RefreshCw style={{ animation: 'spin 2s linear infinite', color: 'var(--accent-primary)' }} size={40} />
      </div>
    );
  }

  const stats = {
    total: contacts.length,
    completed: contacts.filter(c => c.status === 'Completed').length,
    calling: contacts.filter(c => c.status === 'Calling').length,
    needsReschedule: contacts.filter(c => c.status === 'NeedsReschedule').length,
    scheduled: contacts.filter(c => c.status === 'Scheduled').length,
  };

  const totalPages = Math.ceil(campaigns.length / pageSize);
  const currentCampaigns = campaigns.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800 }}>Campaigns</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>Each uploaded CSV is a separate campaign with its own stats & call history</p>
        </div>
        <button 
          className="btn btn-primary"
          onClick={() => {
            setShowUploadModal(true);
            setUploadResult(null);
            setUploadFile(null);
          }}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <Plus size={18} />
          New Campaign
        </button>
      </div>

      {/* Premium Slim Stats Header Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '16px', marginBottom: '28px' }}>
        {[
          { label: 'Currently Dialing', value: stats.calling, color: 'var(--accent-secondary)', icon: Phone },
          { label: 'Needs Reschedule', value: stats.needsReschedule, color: 'var(--accent-warning)', icon: AlertCircle },
          { label: 'Active Concurrency', value: `${concurrency.current} / ${concurrency.limit}`, color: 'var(--accent-primary)', icon: BarChart2 },
        ].map(s => (
          <div key={s.label} className="glass-panel" style={{ padding: '18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div className="icon-badge" style={{ background: `${s.color}18`, color: s.color }}>
              <s.icon size={20} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {campaigns.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '60px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <FileText size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px', alignSelf: 'center' }} />
          <p style={{ color: 'var(--text-secondary)' }}>No campaigns yet. Click <strong>New Campaign</strong> to import a CSV/Excel file.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {currentCampaigns.map((campaign, index) => {
            const total = campaign.total_contacts || 1;
            const s = campaign.stats;
            const completionPct = Math.round((s.completed / total) * 100);
            const isExpanded = expandedId === campaign.id;
            const history = historyMap[campaign.id] || [];

            const HISTORY_PER_PAGE = 20;
            const historyPage = historyPages[campaign.id] || 1;
            const totalHistoryPages = Math.ceil(history.length / HISTORY_PER_PAGE);
            const currentHistory = history.slice((historyPage - 1) * HISTORY_PER_PAGE, historyPage * HISTORY_PER_PAGE);

            const isRunning = campaign.status === 'running' || callingId === campaign.id;
            const eligible = s.pending + s.needs_reschedule + s.failed;

            return (
              <div key={campaign.id} style={{ borderBottom: index < currentCampaigns.length - 1 ? '1px solid var(--border-color)' : 'none' }}>
                {/* Campaign Header Row */}
                <div
                  style={{ padding: '20px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '16px' }}
                  onClick={() => toggleExpand(campaign.id)}
                >
                  {/* Expand arrow */}
                  <div style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  </div>

                  {/* Campaign name & date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem', fontFamily: 'var(--font-display)' }}>
                        {campaign.file_name}
                      </span>
                      <span style={{
                        fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px', borderRadius: '20px',
                        background: `${STATUS_COLORS[campaign.status]}22`,
                        color: STATUS_COLORS[campaign.status],
                        textTransform: 'uppercase', letterSpacing: '0.05em'
                      }}>
                        {campaign.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Uploaded {formatDate(campaign.uploaded_at)} &nbsp;·&nbsp; {campaign.total_contacts} leads
                    </div>
                  </div>

                  {/* Mini stat pills */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
                    {[
                      { label: 'Done', val: s.completed, color: '#10b981' },
                      { label: 'Calling', val: s.calling, color: '#6366f1' },
                      { label: 'Pending', val: s.pending, color: '#94a3b8' },
                      { label: 'Reschedule', val: s.needs_reschedule, color: '#f59e0b' },
                      { label: 'Scheduled', val: s.scheduled, color: '#8b5cf6' },
                      { label: 'Failed', val: s.failed, color: '#ef4444' },
                    ].map(stat => stat.val > 0 && (
                      <span key={stat.label} style={{
                        fontSize: '0.75rem', padding: '3px 8px', borderRadius: '12px',
                        background: `${stat.color}18`, color: stat.color, fontWeight: 600
                      }}>
                        {stat.val} {stat.label}
                      </span>
                    ))}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      className="btn btn-primary"
                      style={{ flexShrink: 0, fontSize: '0.85rem', padding: '8px 16px' }}
                      disabled={isRunning || eligible === 0}
                      onClick={e => { e.stopPropagation(); startCampaign(campaign.id); }}
                    >
                      <Play size={14} />
                      {isRunning ? 'Running...' : 'Start'}
                    </button>
                    
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '8px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)' }}
                      onClick={e => { e.stopPropagation(); deleteCampaign(campaign.id); }}
                      title="Delete Campaign"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ height: '3px', background: 'var(--bg-tertiary)' }}>
                  <div style={{
                    height: '100%',
                    width: `${completionPct}%`,
                    background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-success))',
                    transition: 'width 0.5s ease'
                  }} />
                </div>

                {/* Expanded: Call History */}
                {isExpanded && (
                  <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-color)' }}>
                    {/* Stats row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 100px), 1fr))', gap: '12px', marginBottom: '20px' }}>
                      {[
                        { icon: Users, label: 'Total Leads', val: campaign.total_contacts, color: 'var(--accent-primary)' },
                        { icon: CheckCircle, label: 'Completed', val: s.completed, color: 'var(--accent-success)' },
                        { icon: Phone, label: 'Calling', val: s.calling, color: 'var(--accent-secondary)' },
                        { icon: AlertCircle, label: 'Needs Action', val: s.needs_reschedule, color: 'var(--accent-warning)' },
                        { icon: Calendar, label: 'Scheduled', val: s.scheduled, color: '#8b5cf6' },
                        { icon: BarChart2, label: 'Answer Rate', val: `${Math.round(((s.completed + s.scheduled) / total) * 100)}%`, color: 'var(--accent-primary)' },
                      ].map(({ icon: Icon, label, val, color }) => (
                        <div key={label} style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                          <Icon size={18} style={{ color, marginBottom: '6px' }} />
                          <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{val}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{label}</div>
                        </div>
                      ))}
                    </div>

                    {/* History table */}
                    <h4 style={{ fontFamily: 'var(--font-display)', marginBottom: '12px', color: 'var(--text-secondary)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Call History ({history.length} calls)
                    </h4>

                    {loadingHistory === campaign.id ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
                      </div>
                    ) : history.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        No calls recorded yet for this campaign.
                      </div>
                    ) : (
                      <div>
                        <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                {['Contact', 'Phone', 'Outcome', 'Duration', 'Date/Time', 'Recording', ''].map(h => (
                                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', position: 'sticky', top: 0, background: 'var(--bg-primary)', zIndex: 1 }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {currentHistory.map(rec => (
                              <React.Fragment key={rec.id}>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.2s' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                                  <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                                    {onViewContact ? (
                                      <button
                                        onClick={() => onViewContact(rec.contact_id)}
                                        title="View this contact's full history, transcripts & recordings"
                                        style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent-primary)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit', fontFamily: 'inherit' }}>
                                        {rec.contact_name}
                                      </button>
                                    ) : rec.contact_name}
                                  </td>
                                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{rec.contact_phone}</td>
                                  <td style={{ padding: '10px 12px' }}>
                                    <span style={{
                                      padding: '3px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                                      background: `${OUTCOME_COLORS[rec.outcome] || '#6b7280'}18`,
                                      color: OUTCOME_COLORS[rec.outcome] || '#6b7280'
                                    }}>{rec.outcome || '—'}</span>
                                  </td>
                                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{formatDuration(rec.duration_sec)}</td>
                                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(rec.started_at)}</td>
                                  <td style={{ padding: '10px 12px' }}>
                                    {rec.recording_url ? (
                                      <audio controls src={rec.recording_url} style={{ height: '28px', minWidth: '150px' }} />
                                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                  </td>
                                  <td style={{ padding: '10px 12px' }}>
                                    {(rec.transcript || rec.summary || rec.callback_raw_text) && (
                                      <button
                                        onClick={() => setExpandedTranscript(expandedTranscript === rec.id ? null : rec.id)}
                                        style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent-primary)', border: 'none', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.75rem' }}>
                                        {expandedTranscript === rec.id ? 'Hide' : 'Details'}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                                {expandedTranscript === rec.id && (
                                  <tr>
                                    <td colSpan={7} style={{ padding: '0 12px 16px' }}>
                                      <div style={{ background: 'var(--bg-secondary)', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.82rem' }}>
                                        {rec.callback_raw_text && (
                                          <div>
                                            <span style={{ color: '#f59e0b', fontWeight: 700 }}>Callback Requested: </span>
                                            <span style={{ color: 'var(--text-secondary)' }}>"{rec.callback_raw_text}"</span>
                                          </div>
                                        )}
                                        {rec.summary && (
                                          <div>
                                            <div style={{ color: 'var(--accent-primary)', fontWeight: 700, marginBottom: '4px' }}>Summary</div>
                                            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{rec.summary}</div>
                                          </div>
                                        )}
                                        {rec.transcript && (
                                          <div>
                                            <div style={{ color: 'var(--accent-secondary)', fontWeight: 700, marginBottom: '4px' }}>Transcript</div>
                                            <div style={{ color: 'var(--text-muted)', lineHeight: 1.7, maxHeight: '200px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.78rem' }}>{rec.transcript}</div>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {totalHistoryPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '15px', padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.01)' }}>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setHistoryPage(campaign.id, Math.max(1, historyPage - 1)); }}
                            disabled={historyPage === 1}
                            className="btn btn-secondary"
                            style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                          >
                            Prev
                          </button>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Page {historyPage} of {totalHistoryPages}
                          </span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); setHistoryPage(campaign.id, Math.min(totalHistoryPages, historyPage + 1)); }}
                            disabled={historyPage === totalHistoryPages}
                            className="btn btn-secondary"
                            style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                )}
              </div>
            );
          })}
          </div>

          <Pagination
            currentPage={currentPage}
            totalItems={campaigns.length}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
          />
        </div>
      )}

      {/* Upload New Campaign Modal */}
      {showUploadModal && (
        <div className="modal-overlay">
          <div className="glass-panel modal-content" style={{ padding: '30px', maxWidth: '540px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '4px' }}>
                  Create New Campaign
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Upload an Excel or CSV file to import school leads</p>
              </div>
              <button 
                onClick={() => setShowUploadModal(false)} 
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {!uploadResult ? (
              <div style={{ textAlign: 'center' }}>
                <input 
                  ref={fileInputRef} 
                  type="file" 
                  style={{ display: 'none' }} 
                  onChange={handleFileChange} 
                  accept=".xlsx, .xls, .csv"
                />
                
                <div 
                  onDragEnter={handleDrag} 
                  onDragOver={handleDrag} 
                  onDragLeave={handleDrag} 
                  onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${dragActive ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    borderRadius: '12px',
                    padding: '40px 20px',
                    background: dragActive ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'var(--transition-smooth)',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadCloud style={{ color: 'var(--text-secondary)', marginBottom: '16px' }} size={48} />
                  <p style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '8px' }}>
                    {uploadFile ? uploadFile.name : 'Drag & drop your Excel file here'}
                  </p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Supports .xlsx, .xls, and .csv files — Columns: Name, PhoneNumber, Email (optional), Notes (optional)
                  </p>
                </div>

                {uploadFile && (
                  <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'center', gap: '12px' }}>
                    <button className="btn btn-secondary" onClick={() => setUploadFile(null)}>Cancel</button>
                    <button className="btn btn-primary" onClick={triggerUpload} disabled={uploadLoading}>
                      {uploadLoading ? <RefreshCw className="animate-spin" style={{ animation: 'spin 2s linear infinite' }} size={16} /> : <FileText size={16} />}
                      {uploadLoading ? 'Processing...' : 'Confirm and Import'}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                  <CheckCircle style={{ color: 'var(--accent-success)' }} size={32} />
                  <div>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem' }}>Import Complete</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      Successfully processed {uploadResult.totalContacts} rows.
                    </p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', margin: '20px 0' }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{uploadResult.totalContacts}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Total</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--accent-success)' }}>{uploadResult.successCount}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Success</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--accent-error)' }}>{uploadResult.errors.length}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Errors</div>
                  </div>
                </div>

                {uploadResult.errors.length > 0 && (
                  <div style={{ marginTop: '20px' }}>
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--accent-warning)', fontSize: '0.9rem' }}>
                      <AlertCircle size={16} />
                      Import Warnings & Errors
                    </h4>
                    <div style={{ maxHeight: '160px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      {uploadResult.errors.map((err: any, idx: number) => (
                        <div key={idx} style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                          Row {err.row}: {err.error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                  <button className="btn btn-secondary" onClick={() => setUploadResult(null)}>
                    Upload Another Sheet
                  </button>
                  <button className="btn btn-primary" onClick={() => setShowUploadModal(false)}>
                    Close
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
