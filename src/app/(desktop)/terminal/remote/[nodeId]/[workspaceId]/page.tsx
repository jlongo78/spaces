'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, ArrowLeft, Globe, Terminal, AlertCircle, Plus,
} from 'lucide-react';
import { TerminalPane } from '@/components/terminal/terminal-pane';
import { TotpGate } from '@/components/auth/totp-gate';
import type { PaneData } from '@/lib/db/queries';
import { api } from '@/lib/api';

export default function RemoteWorkspacePage({
  params,
}: {
  params: Promise<{ nodeId: string; workspaceId: string }>;
}) {
  return (
    <TotpGate>
      {(terminalToken) => <RemoteWorkspaceInner params={params} terminalToken={terminalToken} />}
    </TotpGate>
  );
}

function RemoteWorkspaceInner({
  params,
  terminalToken,
}: {
  params: Promise<{ nodeId: string; workspaceId: string }>;
  terminalToken: string;
}) {
  const router = useRouter();
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [panes, setPanes] = useState<PaneData[]>([]);
  const [workspaceName, setWorkspaceName] = useState<string>('');
  const [workspaceColor, setWorkspaceColor] = useState<string>('#6366f1');
  const [nodeName, setNodeName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [maximized, setMaximized] = useState<string | null>(null);

  // Resolve params
  useEffect(() => {
    params.then(p => {
      setNodeId(p.nodeId);
      setWorkspaceId(p.workspaceId);
    });
  }, [params]);

  // Fetch workspace data from remote node via proxy
  useEffect(() => {
    if (!nodeId || !workspaceId) return;

    const fetchPanes = fetch(api(`/api/network/proxy/${nodeId}/workspaces/${workspaceId}`))
      .then(r => {
        if (!r.ok) throw new Error(`Failed to fetch workspace (${r.status})`);
        return r.json();
      });

    const fetchWorkspaces = fetch(api(`/api/network/proxy/${nodeId}/workspaces`))
      .then(r => {
        if (!r.ok) throw new Error(`Failed to fetch workspaces (${r.status})`);
        return r.json();
      });

    Promise.all([fetchPanes, fetchWorkspaces])
      .then(([panesData, wsData]) => {
        // Always pass nodeId for remote panes so the terminal server
        // proxies the connection to the remote node.
        const remotePanes: PaneData[] = (panesData.panes || []).map((p: any) => ({
          ...p,
          nodeId: nodeId,
          // Ensure booleans are correct types from the JSON
          isPopout: !!p.isPopout,
        }));
        setPanes(remotePanes);
        const ws = wsData.workspaces?.find(
          (w: any) => String(w.id) === workspaceId
        );
        if (ws) {
          setWorkspaceName(ws.name);
          setWorkspaceColor(ws.color);
          setNodeName(ws.nodeName || '');
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [nodeId, workspaceId]);

  // No-op handlers for remote panes (read-only, can't modify remote DB)
  const handleClose = useCallback(() => {}, []);
  const handleUpdate = useCallback(() => {}, []);
  const toggleMaximize = useCallback((id: string) => {
    setMaximized(prev => prev === id ? null : id);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100">
        <AlertCircle className="w-8 h-8 text-red-500 mb-3" />
        <p className="text-sm text-zinc-400 mb-4">{error}</p>
        <button
          onClick={() => router.push('/terminal')}
          className="flex items-center gap-2 px-4 py-2 text-sm border border-zinc-700 text-zinc-400 rounded-lg hover:text-white hover:border-zinc-500 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Spaces
        </button>
      </div>
    );
  }

  const visiblePanes = panes.filter(p => !p.isPopout);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/terminal')}
            className="p-1.5 -ml-1 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-md transition-colors"
            title="Back to Spaces"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-zinc-800" />
          <Globe className="w-3.5 h-3.5 text-zinc-500" />
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: workspaceColor }}
          />
          <span className="text-sm font-semibold">{workspaceName || 'Remote Workspace'}</span>
          {nodeName && (
            <span className="text-xs text-zinc-500">on {nodeName}</span>
          )}
          <span className="text-[11px] text-zinc-500">
            {visiblePanes.length} pane{visiblePanes.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Terminal grid */}
      {visiblePanes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <Terminal className="w-10 h-10 text-zinc-700 mx-auto" />
            <p className="text-zinc-500 text-sm">This remote workspace has no panes.</p>
          </div>
        </div>
      ) : (
        <div
          className="flex-1 p-2 gap-2 overflow-auto"
          style={{
            display: 'grid',
            gridTemplateColumns: visiblePanes.length === 1 ? '1fr'
              : visiblePanes.length <= 2 ? 'repeat(2, 1fr)'
              : visiblePanes.length <= 4 ? 'repeat(2, 1fr)'
              : 'repeat(3, 1fr)',
            gridAutoRows: visiblePanes.length <= 2 ? '1fr' : 'minmax(300px, 1fr)',
          }}
        >
          {visiblePanes.map((pane) => (
            maximized && maximized !== pane.id ? null : (
              <TerminalPane
                key={pane.id}
                pane={pane}
                onClose={handleClose}
                onUpdate={handleUpdate}
                isMaximized={maximized === pane.id}
                onToggleMaximize={toggleMaximize}
                terminalToken={terminalToken}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}
