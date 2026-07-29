import React, { useState } from 'react';
import api from '../api';
import { Lock, Mail, RefreshCw, KeyRound } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (token: string, user?: any) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function Login({ onLoginSuccess, showToast }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Cognito first-login flow: a school user signing in with the temporary
  // password issued at onboarding must choose a real one before they get a token.
  const [challengeSession, setChallengeSession] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password });
      if (res.data.challenge === 'NEW_PASSWORD_REQUIRED') {
        setChallengeSession(res.data.session);
        showToast('Please set a new password to continue', 'success');
        return;
      }
      showToast(`Welcome back${res.data.user?.school_name ? `, ${res.data.user.school_name}` : ''}!`, 'success');
      onLoginSuccess(res.data.token, res.data.user);
    } catch (err: any) {
      showToast(err.response?.data?.detail || err.response?.data?.error || 'Authentication failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/set-new-password', {
        email,
        new_password: newPassword,
        session: challengeSession,
      });
      showToast('Password updated — welcome!', 'success');
      onLoginSuccess(res.data.token, res.data.user);
    } catch (err: any) {
      showToast(err.response?.data?.detail || 'Could not set the new password', 'error');
    } finally {
      setLoading(false);
    }
  };

  const inChallenge = !!challengeSession;

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      padding: '20px',
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: '420px',
        padding: '40px 30px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'rgba(59, 130, 246, 0.1)',
            color: 'var(--accent-primary)',
            marginBottom: '16px',
            border: '1px solid rgba(59, 130, 246, 0.2)'
          }}>
            {inChallenge ? <KeyRound size={28} /> : <Lock size={28} />}
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2.5rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '8px' }}>
            Call Manager
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '6px' }}>
            {inChallenge
              ? 'Choose a new password for your account'
              : 'Log in to manage automated student outreach'}
          </p>
        </div>

        {inChallenge ? (
          <form onSubmit={handleSetNewPassword} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="form-group">
              <label className="form-label">New Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  className="form-input"
                  style={{ paddingLeft: '48px', width: '100%' }}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                At least 8 characters, with an uppercase letter, a lowercase letter and a number.
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  className="form-input"
                  style={{ paddingLeft: '48px', width: '100%' }}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }} disabled={loading}>
              {loading ? <RefreshCw style={{ animation: 'spin 2s linear infinite' }} size={18} /> : 'Set Password & Continue'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="email"
                  className="form-input"
                  style={{ paddingLeft: '48px', width: '100%' }}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="password"
                  className="form-input"
                  style={{ paddingLeft: '48px', width: '100%' }}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }} disabled={loading}>
              {loading ? <RefreshCw style={{ animation: 'spin 2s linear infinite' }} size={18} /> : 'Access Dashboard'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
