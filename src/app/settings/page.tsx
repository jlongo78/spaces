'use client';

import { useState, useEffect, useRef } from 'react';
import { useSync } from '@/hooks/use-sessions';
import { Settings, RefreshCw, FolderOpen, Loader2, Shield, CheckCircle2, BarChart3 } from 'lucide-react';
import { api } from '@/lib/api';
import { track, setOptOut } from '@/lib/telemetry';

const isServerEdition = process.env.NEXT_PUBLIC_EDITION === 'server';

export default function SettingsPage() {
  const sync = useSync();
  const [syncResult, setSyncResult] = useState<string>('');

  // TOTP state
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpLoading, setTotpLoading] = useState(true);
  const [setupMode, setSetupMode] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Telemetry state
  const [telemetryOptOut, setTelemetryOptOut] = useState(false);
  const [telemetryLoading, setTelemetryLoading] = useState(true);

  useEffect(() => {
    if (!isServerEdition) {
      setTotpLoading(false);
      return;
    }
    fetch(api('/api/auth/totp/status'))
      .then(r => r.json())
      .then(data => {
        setTotpEnabled(data.enabled);
        setTotpLoading(false);
      })
      .catch(() => setTotpLoading(false));
  }, []);

  useEffect(() => {
    fetch(api('/api/config'))
      .then(r => r.json())
      .then(data => {
        setTelemetryOptOut(data.telemetryOptOut);
        setTelemetryLoading(false);
      })
      .catch(() => setTelemetryLoading(false));
  }, []);

  const handleSync = async () => {
    const result = await sync.mutateAsync();
    setSyncResult(`Synced ${result.projects} projects, ${result.sessions} sessions, enriched ${result.enriched}`);
    track('sync_completed', { projects: result.projects, sessions: result.sessions, enriched: result.enriched });
  };

  const handleTelemetryToggle = async () => {
    const newOptOut = !telemetryOptOut;
    setTelemetryOptOut(newOptOut);
    setOptOut(newOptOut);
    track('telemetry_toggled', { enabled: !newOptOut });
    await fetch(api('/api/config'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telemetryOptOut: newOptOut }),
    });
  };

  const startSetup = async () => {
    setSetupMode(true);
    setVerifyError('');
    setVerifyCode('');
    const res = await fetch(api('/api/auth/totp/setup'), { method: 'POST' });
    const data = await res.json();
    setQrDataUrl(data.qrDataUrl);
    setTotpSecret(data.secret);
    setTimeout(() => codeInputRef.current?.focus(), 100);
  };

  const handleVerify = async (code: string) => {
    if (code.length !== 6) return;
    setVerifyLoading(true);
    setVerifyError('');

    const res = await fetch(api('/api/auth/totp/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, action: 'enable' }),
    });
    const data = await res.json();
    setVerifyLoading(false);

    if (data.success) {
      setTotpEnabled(true);
      setSetupMode(false);
      setQrDataUrl('');
      setTotpSecret('');
      setVerifyCode('');
    } else {
      setVerifyError(data.error || 'Invalid code');
      setVerifyCode('');
      codeInputRef.current?.focus();
    }
  };

  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setVerifyCode(digits);
    setVerifyError('');
    if (digits.length === 6) {
      handleVerify(digits);
    }
  };

  const handleDisable = async () => {
    if (!confirm('Disable 2FA? You will need to set it up again to use terminals.')) return;
    // Delete the TOTP record by setting up a new one and not enabling it
    // (simplest approach — the setup endpoint does INSERT OR REPLACE)
    await fetch(api('/api/auth/totp/setup'), { method: 'POST' });
    // The new record has enabled=0, so effectively disabled
    setTotpEnabled(false);
    setSetupMode(false);
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure Spaces</p>
      </div>

      <div className="space-y-6">
        {/* Terminal Security / 2FA — server edition only */}
        {isServerEdition && <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4" />
            Terminal Security
          </h3>

          {totpLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading...
            </div>
          ) : totpEnabled && !setupMode ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                <span className="text-sm font-medium text-green-500">2FA Enabled</span>
              </div>
              <p className="text-xs text-zinc-500">
                Two-factor authentication is required each time you open a terminal session.
                Tokens are valid for 8 hours.
              </p>
              <button
                onClick={handleDisable}
                className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
              >
                Disable 2FA
              </button>
            </div>
          ) : setupMode ? (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)
              </p>

              {qrDataUrl ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="bg-white p-3 rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrDataUrl} alt="TOTP QR Code" width={200} height={200} />
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-zinc-600 mb-1">Manual entry key:</p>
                    <code className="text-xs bg-zinc-800 px-2 py-1 rounded font-mono select-all">
                      {totpSecret}
                    </code>
                  </div>
                </div>
              ) : (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
                </div>
              )}

              <div>
                <label className="text-xs text-zinc-400 block mb-1.5">
                  Enter the 6-digit code from your authenticator
                </label>
                <input
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  disabled={verifyLoading}
                  className="w-40 px-3 py-2 text-lg font-mono tracking-[0.3em] text-center bg-zinc-800 border border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500 text-white disabled:opacity-50"
                />
                {verifyLoading && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-zinc-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Verifying...
                  </div>
                )}
                {verifyError && (
                  <p className="text-xs text-red-400 mt-2">{verifyError}</p>
                )}
              </div>

              <button
                onClick={() => { setSetupMode(false); setQrDataUrl(''); setTotpSecret(''); }}
                className="text-xs text-zinc-500 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-zinc-400">
                Two-factor authentication adds an extra layer of security to terminal access.
                You&apos;ll need an authenticator app to generate codes.
              </p>
              <button
                onClick={startSetup}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-500 text-white rounded-md hover:bg-indigo-600"
              >
                <Shield className="w-4 h-4" />
                Set up 2FA
              </button>
            </div>
          )}
        </div>}

        {/* Data Source */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <FolderOpen className="w-4 h-4" />
            Data Source
          </h3>
          <div className="space-y-3 text-sm">
            <div>
              <label className="text-muted-foreground text-xs">Claude Data Directory</label>
              <p className="font-mono text-xs mt-1 p-2 bg-zinc-50 dark:bg-zinc-800 rounded">
                ~/.claude/
              </p>
            </div>
            <div>
              <label className="text-muted-foreground text-xs">Spaces Database</label>
              <p className="font-mono text-xs mt-1 p-2 bg-zinc-50 dark:bg-zinc-800 rounded">
                ~/.spaces/spaces.db
              </p>
            </div>
          </div>
        </div>

        {/* Sync */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <RefreshCw className="w-4 h-4" />
            Data Sync
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            Force a full re-scan of all Claude Code sessions. This rebuilds the index from scratch.
          </p>
          <button
            onClick={handleSync}
            disabled={sync.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-500 text-white rounded-md hover:bg-indigo-600 disabled:opacity-50"
          >
            {sync.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Re-sync Now
          </button>
          {syncResult && (
            <p className="text-xs text-green-600 mt-2">{syncResult}</p>
          )}
        </div>

        {/* Telemetry */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <BarChart3 className="w-4 h-4" />
            Telemetry
          </h3>
          <p className="text-sm text-muted-foreground mb-3">
            Anonymous usage data helps us understand how Spaces is used and improve the product.
            No file paths, session content, or personal information is ever collected.
          </p>
          {telemetryLoading ? (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading...
            </div>
          ) : (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!telemetryOptOut}
                onChange={handleTelemetryToggle}
                className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-700 text-indigo-500 focus:ring-indigo-500"
              />
              <span className="text-sm">Send anonymous usage data</span>
            </label>
          )}
        </div>

        {/* About */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <Settings className="w-4 h-4" />
            About
          </h3>
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Version:</span> 0.1.0</p>
            <p><span className="text-muted-foreground">Data access:</span> Read-only (never modifies ~/.claude/)</p>
            <p className="text-muted-foreground text-xs mt-2">
              Spaces is an open-source agent workspace manager.
              All session data stays local on your machine.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
