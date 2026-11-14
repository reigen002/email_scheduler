'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function LoginClient() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get('error');

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, router]);

  const handleGoogleLogin = () => {
    window.location.href = `${API_URL}/api/auth/google`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) { setError('Email is required.'); return; }
    if (!password) { setError('Password is required.'); return; }
    if (mode === 'register' && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (mode === 'register') {
      const fullName = name.trim();
      if (fullName.length < 2 || fullName.length > 100) {
        setError('Full name must be between 2 and 100 characters.');
        return;
      }
      if (!/^\p{L}[\p{L}\p{M} .'’\-]*$/u.test(fullName)) {
        setError('Full name must start with a letter and contain only letters, spaces, apostrophes, hyphens or periods.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'register'
        ? { email, password, name: name.trim() }
        : { email, password };

      const { data } = await axios.post(`${API_URL}${endpoint}`, body);
      login(data.token, data.user);
      router.replace('/dashboard');
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error ?? 'Something went wrong. Please try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div style={s.page}>
        <div style={s.spinner} />
      </div>
    );
  }

  const oauthErrors: Record<string, string> = {
    access_denied: 'Google access was denied.',
    auth_failed: 'Google authentication failed.',
    missing_token: 'Login failed. Please try again.',
    missing_code: 'Login failed. Please try again.',
    invalid_token: 'Invalid session. Please try again.',
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* Title */}
        <h1 style={s.title}>{mode === 'login' ? 'Login' : 'Register'}</h1>

        {/* OAuth error */}
        {urlError && (
          <div style={s.errorBox}>
            {oauthErrors[urlError] ?? 'Something went wrong. Please try again.'}
          </div>
        )}

        {/* API error */}
        {error && <div style={s.errorBox}>{error}</div>}

        {/* Google Button */}
        <button
          id="google-login-btn"
          type="button"
          onClick={handleGoogleLogin}
          style={s.googleBtn}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#d4edda')}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#e8f5e9')}
        >
          <GoogleIcon />
          {mode === 'login' ? 'Login with Google' : 'Register with Google'}
        </button>

        {/* Divider */}
        <div style={s.dividerRow}>
          <div style={s.dividerLine} />
          <span style={s.dividerText}>or sign up through email</span>
          <div style={s.dividerLine} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Name field (register only) */}
          {mode === 'register' && (
            <input
              id="name-input"
              type="text"
              placeholder="Full Name"
              aria-label="Full Name"
              autoComplete="name"
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={e => setName(e.target.value)}
              style={{
                ...s.input,
                borderColor: focusedField === 'name' ? '#4caf50' : 'transparent',
              }}
              onFocus={() => setFocusedField('name')}
              onBlur={() => setFocusedField(null)}
            />
          )}

          {/* Email */}
          <input
            id="email-input"
            type="email"
            placeholder="Email ID"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{
              ...s.input,
              borderColor: focusedField === 'email' ? '#4caf50' : 'transparent',
            }}
            onFocus={() => setFocusedField('email')}
            onBlur={() => setFocusedField(null)}
          />

          {/* Password */}
          <input
            id="password-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={{
              ...s.input,
              borderColor: focusedField === 'password' ? '#4caf50' : 'transparent',
            }}
            onFocus={() => setFocusedField('password')}
            onBlur={() => setFocusedField(null)}
          />

          {/* Submit */}
          <button
            id="submit-btn"
            type="submit"
            disabled={submitting}
            style={{
              ...s.loginBtn,
              opacity: submitting ? 0.7 : 1,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={e => { if (!submitting) e.currentTarget.style.backgroundColor = '#43a047'; }}
            onMouseLeave={e => { if (!submitting) e.currentTarget.style.backgroundColor = '#4caf50'; }}
          >
            {submitting
              ? (mode === 'login' ? 'Logging in…' : 'Creating account…')
              : (mode === 'login' ? 'Login' : 'Create Account')}
          </button>
        </form>

        {/* Toggle mode */}
        <p style={s.toggleText}>
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            style={s.toggleBtn}
          >
            {mode === 'login' ? 'Register' : 'Log in'}
          </button>
        </p>
      </div>
    </div>
  );
}

/* ── Styles ──────────────────────────────────────────────────── */
const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  card: {
    width: '100%',
    maxWidth: '460px',
    backgroundColor: '#ffffff',
    border: '1px solid #e0e0e0',
    borderRadius: '16px',
    padding: '48px 40px 44px',
    boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  title: {
    fontSize: '32px',
    fontWeight: 800,
    color: '#111111',
    textAlign: 'center',
    margin: '0 0 8px',
    letterSpacing: '-0.5px',
  },
  errorBox: {
    backgroundColor: '#fdecea',
    color: '#c62828',
    fontSize: '13px',
    padding: '10px 14px',
    borderRadius: '8px',
    border: '1px solid #f5c6c6',
  },
  googleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    width: '100%',
    padding: '13px 20px',
    backgroundColor: '#e8f5e9',
    border: 'none',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: 500,
    color: '#1a1a1a',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },
  dividerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    margin: '4px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    backgroundColor: '#e0e0e0',
  },
  dividerText: {
    fontSize: '13px',
    color: '#9e9e9e',
    whiteSpace: 'nowrap',
  },
  input: {
    width: '100%',
    padding: '14px 16px',
    backgroundColor: '#f5f5f5',
    border: '1.5px solid transparent',
    borderRadius: '10px',
    fontSize: '14px',
    color: '#333',
    outline: 'none',
    transition: 'border-color 0.15s ease',
    boxSizing: 'border-box',
  },
  loginBtn: {
    width: '100%',
    padding: '14px 20px',
    backgroundColor: '#4caf50',
    border: 'none',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: 600,
    color: '#ffffff',
    transition: 'background-color 0.15s ease',
    marginTop: '4px',
  },
  toggleText: {
    textAlign: 'center',
    fontSize: '13px',
    color: '#757575',
    marginTop: '4px',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    color: '#4caf50',
    fontWeight: 600,
    fontSize: '13px',
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
  },
  spinner: {
    width: '32px',
    height: '32px',
    border: '3px solid #e8f5e9',
    borderTop: '3px solid #4caf50',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}
