import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes.
 *
 * Without this, one bad value — an appointment with a null contact, a date
 * that won't parse — throws during render and React unmounts the whole tree,
 * leaving a completely blank white page with the reason visible only in the
 * console. Staff see "the dashboard is broken" and have nothing to report.
 *
 * A boundary can only catch errors thrown while RENDERING. Failures inside
 * event handlers and promises (i.e. API calls) never reach it — those are
 * handled by getErrorMessage in api.ts.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[UI] Render error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    // A crash caused by a corrupt cached user/token would recur on every
    // reload, leaving the app permanently unusable. Let the user clear that
    // state and sign in fresh without opening devtools.
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', padding: '20px',
      }}>
        <div className="glass-panel" style={{ maxWidth: '520px', width: '100%', padding: '32px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '52px', height: '52px', borderRadius: '50%', marginBottom: '16px',
            background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-error)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
          }}>
            <AlertTriangle size={26} />
          </div>

          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '8px' }}>
            Something broke on this page
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            The rest of your data is safe — this is a display problem, not a lost
            record. Reloading usually fixes it.
          </p>

          <pre style={{
            marginTop: '16px', padding: '12px', borderRadius: '10px',
            background: 'rgba(0,0,0,0.25)', color: 'var(--text-muted)',
            fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: '140px', overflowY: 'auto',
          }}>
            {this.state.error.message || String(this.state.error)}
          </pre>

          <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
            <button className="btn btn-primary" onClick={this.handleReload} style={{ flexGrow: 1, justifyContent: 'center' }}>
              <RefreshCw size={16} /> Reload the page
            </button>
            <button className="btn btn-secondary" onClick={this.handleReset} style={{ justifyContent: 'center' }}>
              Sign out and reset
            </button>
          </div>

          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '14px' }}>
            If this keeps happening, send the message above to your administrator.
          </p>
        </div>
      </div>
    );
  }
}
