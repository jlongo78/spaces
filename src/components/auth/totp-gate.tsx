'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Shield, Loader2, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const SESSION_KEY = 'spaces-terminal-token';

interface TotpGateProps {
  children: (terminalToken: string) => React.ReactNode;
}

export function TotpGate({ children }: TotpGateProps) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'not-setup' | 'prompt' | 'authorized'>('loading');
  const [token, setToken] = useState<string>('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check for existing token in sessionStorage
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      setToken(stored);
      setStatus('authorized');
      return;
    }

    // Check TOTP status
    fetch(api('/api/auth/totp/status'))
      .then(r => r.json())
      .then(data => {
        if (!data.enabled) {
          setStatus('not-setup');
        } else {
          setStatus('prompt');
          setTimeout(() => codeRef.current?.focus(), 100);
        }
      })
      .catch(() => setStatus('not-setup'));
  }, []);

  const verify = useCallback(async (verifyCode: string) => {
    if (verifyCode.length !== 6) return;
    setVerifying(true);
    setError('');

    const res = await fetch(api('/api/auth/totp/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: verifyCode, action: 'verify' }),
    });
    const data = await res.json();
    setVerifying(false);

    if (data.success && data.token) {
      sessionStorage.setItem(SESSION_KEY, data.token);
      setToken(data.token);
      setStatus('authorized');
    } else {
      setError(data.error || 'Invalid code');
      setCode('');
      codeRef.current?.focus();
    }
  }, []);

  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError('');
    if (digits.length === 6) {
      verify(digits);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (status === 'authorized') {
    return <>{children(token)}</>;
  }

  if (status === 'not-setup') {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="text-center space-y-4 max-w-sm">
          <Shield className="w-12 h-12 mx-auto text-zinc-600" />
          <h2 className="text-lg font-semibold text-white">2FA Required</h2>
          <p className="text-sm text-zinc-400">
            Two-factor authentication must be set up before you can use terminals.
          </p>
          <button
            onClick={() => router.push('/settings')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500"
          >
            <Settings className="w-4 h-4" />
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  // prompt
  return (
    <div className="flex items-center justify-center h-screen bg-zinc-950">
      <div className="text-center space-y-4 max-w-sm">
        <Shield className="w-12 h-12 mx-auto text-indigo-500" />
        <h2 className="text-lg font-semibold text-white">Terminal Verification</h2>
        <p className="text-sm text-zinc-400">
          Enter the 6-digit code from your authenticator app.
        </p>
        <div>
          <input
            ref={codeRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            value={code}
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
          {error && (
            <p className="text-sm text-red-400 mt-3">{error}</p>
          )}
        </div>
        <p className="text-[11px] text-zinc-600">
          Token is valid for 8 hours after verification.
        </p>
      </div>
    </div>
  );
}
