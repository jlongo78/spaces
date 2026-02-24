'use client';

import { useState, useEffect } from 'react';
import { useSync } from '@/hooks/use-sessions';
import { useRouter } from 'next/navigation';
import { MobileHeader } from '@/components/mobile/mobile-header';
import { RefreshCw, FolderOpen, Loader2, Shield, CheckCircle2, BarChart3, Settings, LogOut, Plus, X, FolderCode } from 'lucide-react';
import { api } from '@/lib/api';
import { setOptOut } from '@/lib/telemetry';
import { HAS_AUTH } from '@/lib/tier';

export default function MobileSettingsPage() {
  const router = useRouter();
  const sync = useSync();
  const [syncResult, setSyncResult] = useState('');
  const [devDirectories, setDevDirectories] = useState<string[]>([]);
  const [newDevDir, setNewDevDir] = useState('');
  const [telemetryOptOut, setTelemetryOptOut] = useState(false);
  const [telemetryLoading, setTelemetryLoading] = useState(true);

  useEffect(() => {
    fetch(api('/api/config'))
      .then(r => r.json())
      .then(data => {
        setTelemetryOptOut(data.telemetryOptOut);
        setDevDirectories(data.devDirectories || []);
        setTelemetryLoading(false);
      })
      .catch(() => setTelemetryLoading(false));
  }, []);

  const saveDevDirectories = async (dirs: string[]) => {
    setDevDirectories(dirs);
    await fetch(api('/api/config'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ devDirectories: dirs }),
    });
  };

  const handleAddDevDir = () => {
    const dir = newDevDir.trim();
    if (!dir || devDirectories.includes(dir)) return;
    const isAbsolute = dir.startsWith('/') || /^[A-Za-z]:[\\/]/.test(dir);
    if (!isAbsolute) return;
    saveDevDirectories([...devDirectories, dir]);
    setNewDevDir('');
  };

  const handleRemoveDevDir = (dir: string) => {
    saveDevDirectories(devDirectories.filter(d => d !== dir));
  };

  const handleSync = async () => {
    const result = await sync.mutateAsync();
    setSyncResult(`Synced ${result.projects} projects, ${result.sessions} sessions`);
  };

  const handleTelemetryToggle = async () => {
    const newOptOut = !telemetryOptOut;
    setTelemetryOptOut(newOptOut);
    setOptOut(newOptOut);
    await fetch(api('/api/config'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telemetryOptOut: newOptOut }),
    });
  };

  const handleLogout = async () => {
    await fetch(api('/api/auth/logout'), { method: 'POST' });
    router.push('/login');
  };

  return (
    <>
      <MobileHeader title="Settings" />

      <div className="px-4 py-4 space-y-4">
        {/* Terminal Security (server edition) */}
        {HAS_AUTH && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4" />
              Terminal Security
            </h3>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-xs text-green-500">2FA Enabled</span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1.5">
              2FA is managed through the login flow.
            </p>
          </div>
        )}

        {/* Data Source */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <FolderOpen className="w-4 h-4" />
            Data Source
          </h3>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-zinc-500">Agent Data:</span>
              <span className="font-mono ml-2">~/.claude/ ~/.codex/ ~/.gemini/</span>
            </div>
            <div>
              <span className="text-zinc-500">Database:</span>
              <span className="font-mono ml-2">~/.spaces/spaces.db</span>
            </div>
          </div>
        </div>

        {/* Development Directories */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <FolderCode className="w-4 h-4" />
            Dev Directories
          </h3>
          <p className="text-[11px] text-zinc-500 mb-3">
            Restrict pane creation to these project roots.
          </p>

          {devDirectories.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {devDirectories.map(dir => (
                <div key={dir} className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800 rounded-md">
                  <FolderOpen className="w-3 h-3 text-amber-500/70 flex-shrink-0" />
                  <span className="font-mono text-[11px] flex-1 truncate">{dir}</span>
                  <button
                    onClick={() => handleRemoveDevDir(dir)}
                    className="text-zinc-500 hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={typeof navigator !== 'undefined' && navigator.platform?.startsWith('Win') ? 'C:\\Users\\you\\projects' : '/home/user/projects'}
              value={newDevDir}
              onChange={(e) => setNewDevDir(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDevDir()}
              className="flex-1 px-2.5 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500 font-mono"
            />
            <button
              onClick={handleAddDevDir}
              disabled={!newDevDir.trim() || !(newDevDir.trim().startsWith('/') || /^[A-Za-z]:[\\/]/.test(newDevDir.trim()))}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-indigo-600 text-white rounded-md disabled:opacity-50"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          </div>
        </div>

        {/* Sync */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <RefreshCw className="w-4 h-4" />
            Data Sync
          </h3>
          <p className="text-[11px] text-zinc-500 mb-3">
            Re-scan all agent sessions.
          </p>
          <button
            onClick={handleSync}
            disabled={sync.isPending}
            className="flex items-center gap-2 px-3 py-2 text-xs bg-indigo-600 text-white rounded-lg disabled:opacity-50"
          >
            {sync.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Re-sync Now
          </button>
          {syncResult && <p className="text-[11px] text-green-500 mt-2">{syncResult}</p>}
        </div>

        {/* Telemetry */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4" />
            Telemetry
          </h3>
          {telemetryLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
          ) : (
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!telemetryOptOut}
                onChange={handleTelemetryToggle}
                className="w-4 h-4 rounded border-zinc-700 text-indigo-500 focus:ring-indigo-500"
              />
              <span className="text-xs">Send anonymous usage data</span>
            </label>
          )}
        </div>

        {/* About */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
            <Settings className="w-4 h-4" />
            About
          </h3>
          <div className="text-xs space-y-1 text-zinc-400">
            <p>Version: 0.1.0</p>
            <p>Data access: Read-only</p>
          </div>
        </div>

        {/* Sign out (server edition) */}
        {HAS_AUTH && (
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm text-red-400 bg-zinc-900 border border-zinc-800 rounded-lg"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        )}
      </div>
    </>
  );
}
