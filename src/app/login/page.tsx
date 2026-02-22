'use client';

import { Suspense, useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2, Shield, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/api';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const iconSrc = `${basePath}/spaces_icon.png`;

type Stage = 'credentials' | 'totp-setup' | 'totp-verify';

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[100dvh] bg-zinc-950 px-6">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || '/';

  const [stage, setStage] = useState<Stage>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // TOTP setup state
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    usernameRef.current?.focus();
  }, []);

  useEffect(() => {
    if (stage === 'totp-setup' || stage === 'totp-verify') {
      setTimeout(() => codeRef.current?.focus(), 100);
    }
  }, [stage]);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch(api('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Login failed');
        setLoading(false);
        return;
      }

      if (data.status === 'setup-totp') {
        setQrDataUrl(data.qrDataUrl);
        setSetupSecret(data.setupSecret);
        setStage('totp-setup');
      } else if (data.status === 'totp-required') {
        setStage('totp-verify');
      } else if (data.status === 'ok') {
        window.location.href = `${basePath}${redirectTo}`;
      }
    } catch {
      setError('Network error');
    }
    setLoading(false);
  };

  const handleTotpSubmit = async (code: string) => {
    if (code.length !== 6) return;

    setVerifying(true);
    setTotpError('');

    try {
      const body: Record<string, string> = { username, password, totpCode: code };
      if (stage === 'totp-setup') {
        body.setupSecret = setupSecret;
      }

      const res = await fetch(api('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setTotpError(data.error || 'Verification failed');
        setTotpCode('');
        codeRef.current?.focus();
      } else if (data.status === 'ok') {
        window.location.href = `${basePath}${redirectTo}`;
      }
    } catch {
      setTotpError('Network error');
      setTotpCode('');
    }
    setVerifying(false);
  };

  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setTotpCode(digits);
    setTotpError('');
    if (digits.length === 6) {
      handleTotpSubmit(digits);
    }
  };

  // ─── Credentials Form ─────────────────────────────────────
  if (stage === 'credentials') {
    return (
      <div className="flex items-center justify-center min-h-[100dvh] bg-zinc-950 px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={iconSrc} alt="Spaces" className="w-14 h-14 mx-auto opacity-60" />
            <h1 className="text-xl font-semibold text-white">Sign in to Spaces</h1>
          </div>

          <form onSubmit={handleCredentials} className="space-y-4">
            <div>
              <label className="text-xs text-zinc-400 block mb-1.5">Username</label>
              <input
                ref={usernameRef}
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:border-indigo-500 text-white"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:border-indigo-500 text-white pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── TOTP Setup (first time) ──────────────────────────────
  if (stage === 'totp-setup') {
    return (
      <div className="flex items-center justify-center min-h-[100dvh] bg-zinc-950 px-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <Shield className="w-10 h-10 mx-auto text-indigo-400" />
            <h2 className="text-lg font-semibold text-white">Set up two-factor authentication</h2>
            <p className="text-sm text-zinc-400">
              Scan this QR code with your authenticator app
            </p>
          </div>

          {qrDataUrl ? (
            <div className="flex flex-col items-center gap-4">
              <div className="bg-zinc-100 p-3 rounded-xl shadow-lg shadow-black/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="TOTP QR Code" width={180} height={180} className="rounded" />
              </div>
              <div className="text-center">
                <p className="text-[10px] text-zinc-500 mb-1">Manual entry key:</p>
                <code className="text-xs bg-zinc-800 px-2 py-1 rounded font-mono select-all text-zinc-300">
                  {setupSecret}
                </code>
              </div>
            </div>
          ) : (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            </div>
          )}

          <div className="text-center">
            <label className="text-xs text-zinc-400 block mb-2">
              Enter the 6-digit code from your authenticator
            </label>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={totpCode}
              onChange={(e) => handleCodeChange(e.target.value)}
              disabled={verifying}
              className="w-48 px-3 py-3 text-2xl font-mono tracking-[0.4em] text-center bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:border-indigo-500 text-white disabled:opacity-50"
            />
            {verifying && (
              <div className="flex items-center justify-center gap-2 mt-3 text-xs text-zinc-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                Verifying...
              </div>
            )}
            {totpError && (
              <p className="text-sm text-red-400 mt-3">{totpError}</p>
            )}
          </div>

          <button
            onClick={() => { setStage('credentials'); setTotpCode(''); setTotpError(''); }}
            className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // ─── TOTP Verify (returning user) ─────────────────────────
  return (
    <div className="flex items-center justify-center min-h-[100dvh] bg-zinc-950 px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={iconSrc} alt="Spaces" className="w-12 h-12 mx-auto" />
          <h2 className="text-lg font-semibold text-white">Two-factor authentication</h2>
          <p className="text-sm text-zinc-400">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>

        <div className="text-center">
          <input
            ref={codeRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            value={totpCode}
            onChange={(e) => handleCodeChange(e.target.value)}
            disabled={verifying}
            className="w-48 px-3 py-3 text-2xl font-mono tracking-[0.4em] text-center bg-zinc-800 border border-zinc-700 rounded-lg focus:outline-none focus:border-indigo-500 text-white disabled:opacity-50"
            autoFocus
          />
          {verifying && (
            <div className="flex items-center justify-center gap-2 mt-3 text-xs text-zinc-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              Verifying...
            </div>
          )}
          {totpError && (
            <p className="text-sm text-red-400 mt-3">{totpError}</p>
          )}
        </div>

        <button
          onClick={() => { setStage('credentials'); setTotpCode(''); setTotpError(''); }}
          className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}
