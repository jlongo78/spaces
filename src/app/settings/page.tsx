'use client';

import { useState } from 'react';
import { useSync } from '@/hooks/use-sessions';
import { Settings, RefreshCw, FolderOpen, Loader2 } from 'lucide-react';

export default function SettingsPage() {
  const sync = useSync();
  const [syncResult, setSyncResult] = useState<string>('');

  const handleSync = async () => {
    const result = await sync.mutateAsync();
    setSyncResult(`Synced ${result.projects} projects, ${result.sessions} sessions, enriched ${result.enriched}`);
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure Spaces</p>
      </div>

      <div className="space-y-6">
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
