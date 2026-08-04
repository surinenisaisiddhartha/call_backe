import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import { RefreshCw, TrendingUp, MessageCircle, AlertTriangle } from 'lucide-react';

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
  'Hot Lead': 'var(--accent-error)',
  'Warm Lead': 'var(--accent-warning)',
  'Time Pass': '#a855f7',
  'Not Interested': 'var(--text-secondary)',
  'Not Reached': 'var(--text-muted)',
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
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  const load = async (windowDays: number) => {
    setLoading(true);
    try {
      const res = await api.get('/analytics/calls', { params: { days: windowDays } });
      setData(res.data);
    } catch (err) {
      showToast(getErrorMessage(err, 'Could not load call insights'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(days); }, [days]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.9rem', fontWeight: 800 }}>Call Insights</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '4px' }}>
            Who is genuinely interested, and what callers are actually asking about.
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
          {/* Say plainly how much of the period this actually covers. A
              percentage over an unstated denominator is worse than no
              percentage — analysis only exists for calls made after it was
              switched on, so early on most calls have none. */}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px' }}>
              {data.caller_classification.map(r => {
                const clickable = r.count > 0 && !!onViewClassification;
                return (
                  <div
                    key={r.label}
                    onClick={clickable ? () => onViewClassification!(r.label) : undefined}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onViewClassification!(r.label); } : undefined}
                    title={clickable ? `Show these ${r.count} leads` : undefined}
                    style={{
                      cursor: clickable ? 'pointer' : 'default',
                      padding: '6px 8px', margin: '0 -8px', borderRadius: '8px',
                      opacity: r.count === 0 ? 0.55 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.85rem', marginBottom: '5px' }}>
                      <span style={{ fontWeight: 700, color: COLOURS[r.label] }}>{r.label}</span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        {r.count} · {r.percent}%
                        {clickable && <span style={{ marginLeft: '8px', color: 'var(--accent-primary)', fontWeight: 600 }}>view →</span>}
                      </span>
                    </div>
                    <div style={{ height: '8px', borderRadius: '999px', background: 'rgba(127,127,127,0.15)', overflow: 'hidden' }}>
                      <div style={{ width: `${r.percent}%`, height: '100%', background: COLOURS[r.label] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <BarList
              title="Interest level"
              hint="How interested they sounded, from the conversation"
              rows={data.interest_level}
            />
            <BarList
              title="How seriously they engaged"
              hint="Serious buyers vs people just browsing"
              rows={data.engagement_quality}
            />
          </div>

          {/* What callers actually asked, detected from their own words. This
              covers every call ever recorded, including those made before LLM
              analysis existed. */}
          <div className="glass-panel">
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>What callers ask about</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
              Detected from the caller's own words across every recorded call — the agent's
              side is excluded, so this counts what they raised, not what we mentioned
            </div>
            {data.questions_asked.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '14px' }}>
                No questions detected yet.
              </div>
            ) : (
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '11px' }}>
                {data.questions_asked.map(r => (
                  <div key={r.label}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.83rem', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600 }}>
                        {r.label}
                        {!r.covered && (
                          <span
                            title="Your knowledge base has no content on this, so the agent cannot answer it"
                            style={{
                              marginLeft: '8px', padding: '1px 7px', borderRadius: '999px',
                              fontSize: '0.68rem', fontWeight: 700,
                              background: 'rgba(239,68,68,0.12)', color: 'var(--accent-error)',
                            }}
                          >can't answer</span>
                        )}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>{r.count} · {r.percent}%</span>
                    </div>
                    <div style={{ height: '7px', borderRadius: '999px', background: 'rgba(127,127,127,0.15)', overflow: 'hidden' }}>
                      <div style={{
                        width: `${r.percent}%`, height: '100%',
                        background: r.covered ? 'var(--accent-primary)' : 'var(--accent-error)',
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
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
