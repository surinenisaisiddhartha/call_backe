import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import { RefreshCw, TrendingUp, MessageCircle, AlertTriangle, Users, Award, Clock, CheckCircle, Activity } from 'lucide-react';

interface Row { label: string; count: number; percent: number; }
type ClassRow = Row;

interface Analytics {
  window_days: number;
  total_contacts: number;
  caller_classification: ClassRow[];
  total_calls: number;
  analysed_calls: number;
  unanalysed_calls: number;
  interest_level: Row[];
  engagement_quality: Row[];
  caller_type: Row[];
  sentiment: Row[];
  primary_topic: Row[];
  topics_mentioned: Row[];
  questions_asked: (Row & { covered: boolean })[];
  knowledge_gaps: { label: string; count: number }[];
  recent_concerns: string[];
}

interface CounselorAnalytics {
  counselor_id: string;
  name: string;
  email: string;
  availability_status: 'Available' | 'InConsultation' | 'OnLeave';
  total_assigned: number;
  completed_count: number;
  conversion_rate: number;
  hot_leads_assigned: number;
  active_leads: number;
  activity_count_7d: number;
  avg_response_hours: number | null;
}

interface Props {
  showToast: (msg: string, type?: 'success' | 'error') => void;
  /** Jump to the Leads Directory already filtered to one classification.
   *  Names are deliberately not listed here — at scale a bucket holds
   *  hundreds of people, so the count links to the real list instead. */
  onViewClassification?: (label: string) => void;
}

/** Colours carry meaning here, so they're fixed per label rather than
 *  assigned by position — otherwise "Cold" could come out green. */
const COLOURS: Record<string, string> = {
  'HOT': 'var(--accent-error)',
  'WARM': 'var(--accent-warning)',
  'COLD': 'var(--text-secondary)',
  Hot: 'var(--accent-error)',
  Warm: 'var(--accent-warning)',
  Cold: 'var(--text-secondary)',
  Unclear: 'var(--text-muted)',
  Serious: 'var(--accent-success)',
  Casual: 'var(--accent-warning)',
  NotInterested: 'var(--text-secondary)',
  Positive: 'var(--accent-success)',
  Neutral: 'var(--text-secondary)',
  Negative: 'var(--accent-error)',
};

function BarList({ title, rows, hint }: { title: string; rows: Row[]; hint?: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="glass-panel" style={{ flex: '1 1 320px', minWidth: 0 }}>
      <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{title}</div>
      {hint && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>{hint}</div>
      )}
      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '14px' }}>
          Nothing yet.
        </div>
      ) : (
        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {rows.map(r => (
            <div key={r.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '4px' }}>
                <span style={{ fontWeight: 600 }}>{r.label}</span>
                <span style={{ color: 'var(--text-muted)' }}>{r.count} · {r.percent}%</span>
              </div>
              <div style={{ height: '7px', borderRadius: '999px', background: 'rgba(127,127,127,0.15)', overflow: 'hidden' }}>
                <div style={{
                  width: `${max ? (r.count / max) * 100 : 0}%`,
                  height: '100%',
                  background: COLOURS[r.label] || 'var(--accent-primary)',
                }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Insights({ showToast, onViewClassification }: Props) {
  const [data, setData] = useState<Analytics | null>(null);
  const [counselorData, setCounselorData] = useState<CounselorAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = async (windowDays: number) => {
    setLoading(true);
    try {
      const [callRes, cnsRes] = await Promise.all([
        api.get('/analytics/calls', { params: { days: windowDays } }),
        api.get('/contacts/counselors/analytics').catch(() => ({ data: [] }))
      ]);
      setData(callRes.data);
      setCounselorData(cnsRes.data || []);
    } catch (err) {
      showToast(getErrorMessage(err, 'Could not load insights'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: 800 }}>Insights & Performance</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
            AI call analysis, caller intent patterns, and admissions counselor conversion performance.
          </p>
        </div>
        <select
          className="form-input"
          style={{ width: '170px' }}
          value={days}
          onChange={e => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ padding: '60px', textAlign: 'center' }}>
          <RefreshCw size={22} style={{ animation: 'spin 2s linear infinite' }} />
        </div>
      ) : !data ? null : (
        <>
          {/* Counselor Performance Section */}
          {counselorData.length > 0 && (
            <div className="glass-panel" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={20} style={{ color: 'var(--accent-primary)' }} />
                  <div>
                    <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 700 }}>Counselor Performance & Conversion</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Conversion rates, response speeds, and weekly activity counts per counselor.</p>
                  </div>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      <th style={{ padding: '10px 12px' }}>Counselor</th>
                      <th style={{ padding: '10px 12px' }}>Status</th>
                      <th style={{ padding: '10px 12px' }}>Conversion Rate</th>
                      <th style={{ padding: '10px 12px' }}>Completed / Total</th>
                      <th style={{ padding: '10px 12px' }}>Avg Response</th>
                      <th style={{ padding: '10px 12px' }}>7d Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counselorData.map((cns, idx) => (
                      <tr key={cns.counselor_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {idx === 0 && <Award size={16} style={{ color: '#f59e0b' }} />}
                          <div>
                            <div>{cns.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>{cns.email}</div>
                          </div>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700,
                            background: cns.availability_status === 'Available' ? 'rgba(16, 185, 129, 0.12)' : cns.availability_status === 'InConsultation' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                            color: cns.availability_status === 'Available' ? '#10b981' : cns.availability_status === 'InConsultation' ? '#f59e0b' : '#ef4444'
                          }}>
                            {cns.availability_status || 'Available'}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontWeight: 800, color: 'var(--accent-primary)', minWidth: '40px' }}>{cns.conversion_rate}%</span>
                            <div style={{ flex: 1, maxWidth: '80px', height: '6px', borderRadius: '999px', background: 'rgba(127,127,127,0.15)', overflow: 'hidden' }}>
                              <div style={{ width: `${Math.min(100, cns.conversion_rate)}%`, height: '100%', background: 'var(--accent-primary)' }} />
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <strong>{cns.completed_count}</strong> <span style={{ color: 'var(--text-muted)' }}>/ {cns.total_assigned}</span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          {cns.avg_response_hours !== null ? `${cns.avg_response_hours}h` : '—'}
                        </td>
                        <td style={{ padding: '12px', fontWeight: 700 }}>
                          {cns.activity_count_7d}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.unanalysed_calls > 0 && (
            <div style={{
              display: 'flex', gap: '10px', alignItems: 'flex-start',
              padding: '12px 14px', borderRadius: '10px',
              background: 'rgba(245, 158, 11, 0.10)', border: '1px solid rgba(245, 158, 11, 0.25)',
            }}>
              <AlertTriangle size={18} style={{ color: 'var(--accent-warning)', flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '0.85rem', lineHeight: 1.45 }}>
                <strong>{data.analysed_calls} of {data.total_calls} calls</strong> in this period have analysis.
                {data.analysed_calls === 0
                  ? ' Analysis runs at the end of each call and was switched on recently, so it will appear from your next call onwards.'
                  : ' The breakdowns below cover only the analysed calls.'}
              </div>
            </div>
          )}

          <div className="glass-panel">
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Who your callers are</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
              One label per person across all {data.total_contacts} leads. Click any row to see
              exactly who is in it — deeds outrank words, so a booked appointment counts as Hot
              however the conversation read
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginTop: '16px' }}>
              {data.caller_classification.map(c => (
                <div
                  key={c.label}
                  onClick={() => onViewClassification?.(c.label)}
                  className="hover-lift"
                  style={{
                    padding: '14px 16px', borderRadius: '10px',
                    background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
                    cursor: onViewClassification ? 'pointer' : 'default',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, color: COLOURS[c.label] || 'var(--text-primary)', fontSize: '0.85rem' }}>
                      {c.label}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{c.percent}%</span>
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '4px', fontFamily: 'var(--font-display)' }}>
                    {c.count}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {data.knowledge_gaps.length > 0 && (
            <div style={{
              display: 'flex', gap: '10px', alignItems: 'flex-start',
              padding: '12px 14px', borderRadius: '10px',
              background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.22)',
            }}>
              <AlertTriangle size={18} style={{ color: 'var(--accent-error)', flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                <strong>Callers asked about things the agent cannot answer.</strong>
                <div style={{ marginTop: '4px' }}>
                  {data.knowledge_gaps.map(g => `${g.label} (${g.count})`).join(', ')} — your website has
                  no content on {data.knowledge_gaps.length === 1 ? 'this' : 'these'}, so the agent could
                  only offer to have someone follow up. Adding a page fixes it for every future caller.
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <BarList
              title="What they came to ask about"
              hint="The one topic each caller cared about most"
              rows={data.primary_topic}
            />
            <BarList
              title="Every topic raised"
              hint="Counts each subject mentioned, not just the main one"
              rows={data.topics_mentioned}
            />
          </div>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <BarList title="Who we reached" rows={data.caller_type} />
            <BarList title="Sentiment" hint="Retell's own read of the caller" rows={data.sentiment} />
          </div>

          <div className="glass-panel">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '0.95rem' }}>
              <MessageCircle size={17} /> What is holding callers back
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
              Objections in the callers' own words — the counts say how many, only these say what to do
            </div>
            {data.recent_concerns.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '14px' }}>
                No concerns recorded yet.
              </div>
            ) : (
              <ul style={{ marginTop: '12px', paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {data.recent_concerns.map((c, i) => (
                  <li key={i} style={{ fontSize: '0.85rem', lineHeight: 1.45 }}>{c}</li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            <TrendingUp size={14} />
            {data.total_calls} calls in the last {data.window_days} days
          </div>
        </>
      )}
    </div>
  );
}
