import React, { useState } from 'react';
import api, { getErrorMessage } from '../api';
import { Lock, Mail, RefreshCw, KeyRound, School as SchoolIcon, ArrowLeft, ArrowRight, AlertCircle } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (token: string, user?: any) => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function Login({ onLoginSuccess, showToast }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Login is two steps: enter the email, which identifies the school it
  // belongs to, then enter the password on a page branded with that school.
  // 'identified' only means the email step is done — NOT that the account
  // exists. The backend deliberately advances every well-formed address so
  // this screen can't be used to discover which addresses are registered.
  const [step, setStep] = useState<'email' | 'password'>('email');
  const [identifiedSchool, setIdentifiedSchool] = useState<{ name: string; location: string | null } | null>(null);

  // Cognito first-login flow: a school user signing in with the temporary
  // password issued at onboarding must choose a real one before they get a token.
  const [challengeSession, setChallengeSession] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Login errors are shown INLINE and stay until the user changes something.
  // A toast is wrong here: it disappears after four seconds, sits in the far
  // corner away from the field that caused it, and on a sign-in screen the
  // message is the whole point — you need to be able to re-read it while
  // retyping. Toasts remain for the rest of the app, where they're transient
  // feedback about work that already succeeded.
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown, fallback: string) => setError(getErrorMessage(err, fallback));

  const handleIdentify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Check the address here rather than spending a round trip to be told
    // it's malformed. The browser's own `type=email` check is lenient —
    // it accepts "a@b" — so a typo like a missing ".com" would otherwise
    // sail through to the password step and fail there instead, where the
    // real cause is much harder to guess.
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      setError('That does not look like a complete email address. Check for a typo.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/identify', { email: trimmed });
      setIdentifiedSchool(
        res.data.school_name
          ? { name: res.data.school_name, location: res.data.school_location || null }
          : null
      );
      setStep('password');
    } catch (err: any) {
      fail(err, 'Could not continue with that email');
    } finally {
      setLoading(false);
    }
  };

  const backToEmail = () => {
    setStep('email');
    setPassword('');
    setIdentifiedSchool(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email: email.trim(), password });
      if (res.data.challenge === 'NEW_PASSWORD_REQUIRED') {
        setChallengeSession(res.data.session);
        return;
      }
      showToast(`Welcome back${res.data.user?.school_name ? `, ${res.data.user.school_name}` : ''}!`, 'success');
      onLoginSuccess(res.data.token, res.data.user);
    } catch (err: any) {
      // Deliberately the SAME wording whether the address is unknown or the
      // password is simply wrong. Distinguishing them would turn this form
      // into an account-enumeration oracle, undoing the care taken in
      // /auth/identify to never confirm whether an account exists.
      if (err?.response?.status === 401) {
        setError('That email and password combination is not correct. Please try again.');
      } else {
        fail(err, 'Could not sign you in');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Your new password must be at least 8 characters long.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/auth/set-new-password', {
        email: email.trim(),
        new_password: newPassword,
        session: challengeSession,
      });
      showToast('Password updated — welcome!', 'success');
      onLoginSuccess(res.data.token, res.data.user);
    } catch (err: any) {
      fail(err, 'Could not set the new password');
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
      padding: '24px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Ambient background glow orbs */}
      <div style={{
        position: 'absolute',
        top: '20%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '500px',
        height: '500px',
        background: 'radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, rgba(139, 92, 246, 0.05) 50%, transparent 70%)',
        zIndex: 0,
        pointerEvents: 'none'
      }} />

      <div className="glass-panel scale-in" style={{
        width: '100%',
        maxWidth: '430px',
        padding: '42px 34px',
        position: 'relative',
        zIndex: 1,
        boxShadow: 'var(--shadow-xl)',
        borderRadius: '16px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <img
            src="/logo.png"
            alt="Response AI"
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              objectFit: 'cover',
              marginBottom: '14px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.15)',
              display: 'inline-block'
            }}
          />
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px', letterSpacing: '-0.02em' }}>
            Response AI
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginTop: '2px', fontWeight: 600 }}>
            Admissions CRM
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '6px' }}>
            {inChallenge
              ? 'Choose a new password for your account'
              : step === 'email'
                ? 'Sign in to access your admission pipeline'
                : 'Enter your password to sign in'}
          </p>
        </div>

        {/* Which account/school the password step belongs to. Shown only once
            the email step is done, so the user can see they're signing in to
            the right school before typing a password. */}
        {!inChallenge && step === 'password' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '12px 14px', marginBottom: '22px', borderRadius: '12px',
            background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.20)',
          }}>
            <SchoolIcon size={20} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <div style={{ minWidth: 0, flexGrow: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3 }}>
                {identifiedSchool ? identifiedSchool.name : 'Platform access'}
              </div>
              <div style={{
                fontSize: '0.8rem', color: 'var(--text-secondary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {identifiedSchool?.location ? `${identifiedSchool.location} · ${email}` : email}
              </div>
            </div>
            <button
              type="button"
              onClick={backToEmail}
              className="btn btn-secondary"
              style={{ padding: '6px 10px', flexShrink: 0 }}
              title="Use a different email"
            >
              <ArrowLeft size={14} /> Change
            </button>
          </div>
        )}

        {/* Inline error — stays put until the user edits a field, so it can be
            re-read while retyping. Shown above the form on every step,
            including the email step. */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              padding: '12px 14px', marginBottom: '18px', borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.10)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
            }}
          >
            <AlertCircle size={18} style={{ color: 'var(--accent-error)', flexShrink: 0, marginTop: '1px' }} />
            <span style={{ fontSize: '0.85rem', lineHeight: 1.45, color: 'var(--text-primary)' }}>
              {error}
            </span>
          </div>
        )}

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
                  onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
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
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
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
          <form
            onSubmit={step === 'email' ? handleIdentify : handleSubmit}
            style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
          >
            {step === 'email' ? (
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="email"
                    className="form-input"
                    style={{ paddingLeft: '48px', width: '100%' }}
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    autoFocus
                    required
                  />
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                  We'll look up which school this address belongs to.
                </div>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">Password</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="password"
                    className="form-input"
                    style={{ paddingLeft: '48px', width: '100%' }}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    autoFocus
                    required
                  />
                </div>
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '10px' }} disabled={loading}>
              {loading
                ? <RefreshCw style={{ animation: 'spin 2s linear infinite' }} size={18} />
                : step === 'email'
                  ? <>Continue <ArrowRight size={16} /></>
                  : 'Access Dashboard'}
            </button>
          </form>
        )}

        <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Product Delivered by <strong>Response Informatics</strong>
        </div>
      </div>
    </div>
  );
}
