'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Loader2, ChevronDown, Trash2, Home, Layers } from 'lucide-react';
import { MobileTerminalPane } from '@/components/mobile/mobile-terminal-pane';
import { TotpGate } from '@/components/auth/totp-gate';
import { AGENT_TYPES, AGENT_LIST } from '@/lib/agents';
import type { IdleState } from '@/hooks/use-idle-detection';
import type { PaneData } from '@/lib/db/queries';
import type { Workspace } from '@/types/claude';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export default function MobileTerminalPage() {
  return (
    <TotpGate>
      {(terminalToken) => <MobileTerminalInner terminalToken={terminalToken} />}
    </TotpGate>
  );
}

function MobileTerminalInner({ terminalToken }: { terminalToken: string }) {
  const [panes, setPanes] = useState<PaneData[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsLoading, setWsLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [entered, setEntered] = useState(false);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showWsPicker, setShowWsPicker] = useState(false);

  // Action queue state
  const [paneIdleStates, setPaneIdleStates] = useState<Record<string, IdleState>>({});
  const [autoSwitchEnabled, setAutoSwitchEnabled] = useState(true);
  const autoSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualOverrideRef = useRef(false);

  const loadWorkspaces = useCallback(async () => {
    const res = await fetch(api('/api/workspaces'));
    const data = await res.json();
    setWorkspaces(data);
    const active = data.find((w: Workspace) => w.isActive);
    setActiveWorkspace(active || null);
    setWsLoading(false);
  }, []);

  const loadPanes = useCallback(async () => {
    const res = await fetch(api('/api/panes'));
    const data = await res.json();
    setPanes(data);
    if (data.length > 0 && !activePaneId) {
      setActivePaneId(data[0].id);
    }
    setLoading(false);
  }, [activePaneId]);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);

  useEffect(() => {
    if (entered) loadPanes();
  }, [entered, loadPanes]);

  const switchWorkspace = useCallback(async (wsId: number) => {
    await fetch(api('/api/workspaces'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'switch', workspaceId: wsId }),
    });
    await loadWorkspaces();
    setActivePaneId(null);
    setLoading(true);
    setPaneIdleStates({});
    const res = await fetch(api('/api/panes'));
    const data = await res.json();
    setPanes(data);
    if (data.length > 0) setActivePaneId(data[0].id);
    setLoading(false);
    setEntered(true);
    setShowWsPicker(false);
  }, [loadWorkspaces]);

  const createNewWorkspace = useCallback(async () => {
    const res = await fetch(api('/api/workspaces'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Space', color: '#6366f1' }),
    });
    const ws = await res.json();
    await switchWorkspace(ws.id);
  }, [switchWorkspace]);

  // Fetch dev directories for default CWD
  const [defaultCwd, setDefaultCwd] = useState('/');
  useEffect(() => {
    fetch(api('/api/config'))
      .then(r => r.json())
      .then(cfg => {
        const dirs: string[] = cfg.devDirectories || [];
        if (dirs.length > 0) setDefaultCwd(dirs[0]);
      })
      .catch(() => {});
  }, []);

  const addPane = useCallback(async (agentType: string) => {
    const id = crypto.randomUUID();
    const agent = AGENT_TYPES[agentType];
    const title = agentType === 'shell' ? 'Terminal' : agent?.name || 'Agent';
    const cwd = defaultCwd;

    const res = await fetch(api('/api/panes'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, title, color: agent?.color || '#6366f1', cwd,
        claudeSessionId: agentType !== 'shell' ? 'new' : undefined,
        agentType,
      }),
    });
    const pane = await res.json();
    setPanes(prev => [...prev, pane]);
    setActivePaneId(pane.id);
    setShowAddMenu(false);
  }, [defaultCwd]);

  const closePane = useCallback(async (id: string) => {
    await fetch(api(`/api/panes/${id}`), { method: 'DELETE' });
    setPaneIdleStates(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setPanes(prev => {
      const next = prev.filter(p => p.id !== id);
      if (activePaneId === id) {
        setActivePaneId(next.length > 0 ? next[0].id : null);
      }
      return next;
    });
  }, [activePaneId]);

  // Idle state change handler
  const handleIdleChange = useCallback((paneId: string, state: IdleState) => {
    setPaneIdleStates(prev => ({ ...prev, [paneId]: state }));
  }, []);

  // Auto-switch: when user types in active pane, after 800ms switch to next idle pane
  const handleUserInput = useCallback((paneId: string) => {
    if (!autoSwitchEnabled) return;
    if (manualOverrideRef.current) {
      manualOverrideRef.current = false;
      return;
    }

    // Clear any existing timer
    if (autoSwitchTimerRef.current) {
      clearTimeout(autoSwitchTimerRef.current);
    }

    autoSwitchTimerRef.current = setTimeout(() => {
      setPaneIdleStates(currentStates => {
        setPanes(currentPanes => {
          // Find first non-active idle pane
          const nextIdle = currentPanes.find(
            p => p.id !== paneId && currentStates[p.id] === 'idle'
          );
          if (nextIdle) {
            setActivePaneId(nextIdle.id);
          }
          return currentPanes; // don't mutate
        });
        return currentStates; // don't mutate
      });
    }, 800);
  }, [autoSwitchEnabled]);

  // Manual tab tap clears auto-switch timer
  const handleTabTap = useCallback((paneId: string) => {
    if (autoSwitchTimerRef.current) {
      clearTimeout(autoSwitchTimerRef.current);
      autoSwitchTimerRef.current = null;
    }
    manualOverrideRef.current = true;
    setActivePaneId(paneId);
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSwitchTimerRef.current) clearTimeout(autoSwitchTimerRef.current);
    };
  }, []);

  // Count idle non-active panes
  const idleCount = panes.filter(
    p => p.id !== activePaneId && paneIdleStates[p.id] === 'idle'
  ).length;

  // ─── Workspace chooser ─────────────────────────────────
  if (!entered) {
    return (
      <div className="flex flex-col items-center justify-center h-[80dvh] px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/spaces_icon.png`} alt="Spaces" className="w-14 h-14 mb-4 opacity-60" />
        <h1 className="text-lg font-bold mb-1">Spaces</h1>
        <p className="text-zinc-500 text-sm mb-6">Choose a workspace</p>

        {wsLoading ? (
          <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
        ) : (
          <div className="w-full max-w-sm space-y-2">
            {workspaces.map(ws => (
              <button
                key={ws.id}
                onClick={() => switchWorkspace(ws.id)}
                className="flex items-center gap-3 w-full p-3.5 bg-zinc-900 border border-zinc-800 rounded-lg active:bg-zinc-800"
              >
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: ws.color }} />
                <span className="text-sm font-medium flex-1 text-left truncate">{ws.name}</span>
                <span className="text-[11px] text-zinc-500">{ws.paneCount || 0} panes</span>
              </button>
            ))}
            <button
              onClick={createNewWorkspace}
              className="flex items-center justify-center gap-2 w-full p-3 text-sm text-zinc-400 border border-zinc-800 border-dashed rounded-lg"
            >
              <Plus className="w-4 h-4" />
              New Workspace
            </button>
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[80dvh]">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
      </div>
    );
  }

  const activePane = panes.find(p => p.id === activePaneId);

  return (
    <div className="flex flex-col h-[calc(100dvh-64px)]">
      {/* Workspace + pane selector header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 flex-shrink-0 bg-zinc-950">
        {/* Home button */}
        <button
          onClick={() => setEntered(false)}
          className="p-1.5 text-zinc-500 hover:text-white"
        >
          <Home className="w-4 h-4" />
        </button>

        {/* Workspace selector */}
        <div className="relative">
          <button
            onClick={() => setShowWsPicker(!showWsPicker)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs bg-zinc-900 border border-zinc-800 rounded-md"
          >
            {activeWorkspace && (
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeWorkspace.color }} />
            )}
            <span className="max-w-[80px] truncate">{activeWorkspace?.name || 'Space'}</span>
            <ChevronDown className="w-3 h-3 text-zinc-500" />
          </button>

          {showWsPicker && (
            <div className="absolute z-50 top-full left-0 mt-1 w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
              {workspaces.map(ws => (
                <button
                  key={ws.id}
                  onClick={() => switchWorkspace(ws.id)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-left hover:bg-zinc-700"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ws.color }} />
                  <span className="truncate flex-1">{ws.name}</span>
                  <span className="text-zinc-500">{ws.paneCount || 0}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pane tabs */}
        <div className="flex-1 flex items-center gap-1 overflow-x-auto">
          {panes.map(pane => {
            const isActive = activePaneId === pane.id;
            const isIdle = !isActive && paneIdleStates[pane.id] === 'idle';
            return (
              <button
                key={pane.id}
                onClick={() => handleTabTap(pane.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full flex-shrink-0 border transition-shadow',
                  isActive
                    ? 'bg-zinc-800 border-zinc-600 text-white'
                    : isIdle
                    ? 'border-transparent text-zinc-300 animate-idle-pulse'
                    : 'border-transparent text-zinc-500'
                )}
                style={isIdle ? { '--pulse-color': pane.color } as React.CSSProperties : undefined}
              >
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    isIdle && 'animate-ping-slow'
                  )}
                  style={{ backgroundColor: pane.color }}
                />
                <span className="max-w-[60px] truncate">{pane.title}</span>
              </button>
            );
          })}

          {/* Idle pane count badge */}
          {idleCount > 0 && (
            <span className="flex-shrink-0 ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">
              {idleCount}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Auto-switch toggle */}
          <button
            onClick={() => setAutoSwitchEnabled(!autoSwitchEnabled)}
            className={cn(
              'p-1.5 rounded-md transition-colors',
              autoSwitchEnabled
                ? 'text-amber-400 bg-amber-500/10'
                : 'text-zinc-600'
            )}
            title={autoSwitchEnabled ? 'Auto-switch: on' : 'Auto-switch: off'}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          {activePane && (
            <button
              onClick={() => closePane(activePane.id)}
              className="p-1.5 text-zinc-500 hover:text-red-400"
              title="Close pane"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowAddMenu(!showAddMenu)}
              className="p-1.5 bg-indigo-600 text-white rounded-md"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {showAddMenu && (
              <div className="absolute z-50 top-full right-0 mt-1 w-48 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
                {AGENT_LIST.map(agent => (
                  <button
                    key={agent.id}
                    onClick={() => addPane(agent.id)}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-xs text-left hover:bg-zinc-700"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: agent.color }} />
                    <span>{agent.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Terminal content — all panes mounted, visibility controlled via CSS */}
      {panes.length > 0 ? (
        <div className="flex-1 relative min-h-0">
          {panes.map(pane => (
            <MobileTerminalPane
              key={pane.id}
              pane={pane}
              isVisible={pane.id === activePaneId}
              onIdleChange={handleIdleChange}
              onUserInput={handleUserInput}
              terminalToken={terminalToken}
            />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/spaces_icon.png`} alt="" className="w-12 h-12 opacity-20" />
          <p className="text-zinc-500 text-sm">No panes.</p>
          <button
            onClick={() => addPane('shell')}
            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Terminal
          </button>
        </div>
      )}
    </div>
  );
}
