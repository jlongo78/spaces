'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Loader2, Terminal, Search, MessageSquare, FolderOpen,
  Clock, ChevronDown, Save, FolderInput, Trash2, Pencil, Check, X,
  Layers, Copy, Home, XCircle, ArrowLeftToLine,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { TerminalPane } from '@/components/terminal/terminal-pane';
import { ColorPicker } from '@/components/common/color-picker';
import { FolderPicker } from '@/components/common/folder-picker';
import { TotpGate } from '@/components/auth/totp-gate';
import { AGENT_TYPES, AGENT_LIST } from '@/lib/agents';
import type { PaneData } from '@/lib/db/queries';
import type { SessionWithMeta, Workspace } from '@/types/claude';
import { api } from '@/lib/api';

export default function TerminalPage() {
  return (
    <TotpGate>
      {(terminalToken) => <TerminalPageInner terminalToken={terminalToken} />}
    </TotpGate>
  );
}

function TerminalPageInner({ terminalToken }: { terminalToken: string }) {
  const router = useRouter();
  const [panes, setPanes] = useState<PaneData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [maximized, setMaximized] = useState<string | null>(null);
  const [poppedOut, setPoppedOut] = useState<Set<string>>(new Set());

  // Workspace state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [showWsPicker, setShowWsPicker] = useState(false);
  const [showSaveAs, setShowSaveAs] = useState(false);
  const [saveAsName, setSaveAsName] = useState('');
  const [saveAsColor, setSaveAsColor] = useState('#6366f1');
  const [editingWs, setEditingWs] = useState<number | null>(null);
  const [editWsName, setEditWsName] = useState('');

  // New pane form state
  const [newTitle, setNewTitle] = useState('');
  const [newCwd, setNewCwd] = useState('');
  const [newColor, setNewColor] = useState('#6366f1');
  const [newClaudeSession, setNewClaudeSession] = useState('');
  const [newAgentType, setNewAgentType] = useState('shell');
  const [newAgentMode, setNewAgentMode] = useState<'new' | 'resume'>('new');
  const [newCustomCommand, setNewCustomCommand] = useState('');

  // Session picker state
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessions, setSessions] = useState<SessionWithMeta[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [selectedSession, setSelectedSession] = useState<SessionWithMeta | null>(null);
  const [filterByCwd, setFilterByCwd] = useState(true);
  const pickerRef = useRef<HTMLDivElement>(null);
  const wsPickerRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // ─── Data Loading ──────────────────────────────────────────

  const loadWorkspaces = useCallback(async () => {
    const res = await fetch(api('/api/workspaces'));
    const data = await res.json();
    setWorkspaces(data);
    const active = data.find((w: Workspace) => w.isActive);
    setActiveWorkspace(active || null);
  }, []);

  const loadPanes = useCallback(async () => {
    const res = await fetch(api('/api/panes'));
    const data = await res.json();
    setPanes(data);
    // Track which panes were popped out
    const popped = new Set<string>();
    for (const p of data) {
      if (p.isPopout) popped.add(p.id);
    }
    setPoppedOut(popped);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadWorkspaces();
    loadPanes();
  }, [loadWorkspaces, loadPanes]);

  // ─── BroadcastChannel for cross-window sync ────────────────

  useEffect(() => {
    const channel = new BroadcastChannel('spaces-panes');
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'popout-opened') {
        setPoppedOut(prev => new Set(prev).add(msg.paneId));
      } else if (msg.type === 'popout-closed') {
        setPoppedOut(prev => {
          const next = new Set(prev);
          next.delete(msg.paneId);
          return next;
        });
        // Refresh panes to get updated state
        loadPanes();
      } else if (msg.type === 'pane-updated') {
        setPanes(prev => prev.map(p =>
          p.id === msg.paneId ? { ...p, ...msg.data } : p
        ));
      }
    };

    return () => channel.close();
  }, [loadPanes]);

  // Counter that increments on workspace switch to trigger popout restore
  const [restoreGen, setRestoreGen] = useState(0);

  // Auto-restore popped-out panes on load and after workspace switch
  useEffect(() => {
    if (loading) return;
    for (const pane of panes) {
      if (pane.isPopout) {
        openPopoutWindow(pane);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, restoreGen]);

  // ─── Session Search ────────────────────────────────────────

  useEffect(() => {
    if (!(newAgentType === 'claude' && newAgentMode === 'resume')) return;
    setSessionsLoading(true);
    const timer = setTimeout(() => {
      const sp = new URLSearchParams({
        sortBy: 'modified', sortDir: 'DESC', limit: '200',
      });
      if (sessionSearch) sp.set('search', sessionSearch);
      if (filterByCwd && newCwd) sp.set('projectPath', newCwd);
      fetch(api(`/api/sessions?${sp}`))
        .then(r => r.json())
        .then(data => { setSessions(data.sessions || []); setSessionsLoading(false); })
        .catch(() => setSessionsLoading(false));
    }, sessionSearch ? 300 : 0);
    return () => clearTimeout(timer);
  }, [newAgentType, newAgentMode, sessionSearch, filterByCwd, newCwd]);

  // Close pickers on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowSessionPicker(false);
      }
      if (wsPickerRef.current && !wsPickerRef.current.contains(e.target as Node)) {
        setShowWsPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ─── Pane Operations ──────────────────────────────────────

  const addPane = useCallback(async () => {
    const id = crypto.randomUUID();
    const agent = AGENT_TYPES[newAgentType];
    const cwd = newCwd
      || (selectedSession?.projectPath)
      || (typeof window !== 'undefined' ? 'C:\\' : '/');

    // For claude resume, pass the session ID; for new agent sessions, pass 'new'
    let claudeSessionId: string | undefined;
    if (newAgentType !== 'shell') {
      if (newAgentMode === 'resume' && agent?.supportsResume) {
        claudeSessionId = selectedSession?.sessionId || newClaudeSession;
      } else {
        claudeSessionId = 'new';
      }
    }

    const title = newTitle
      || (selectedSession ? (selectedSession.customName || selectedSession.firstPrompt?.slice(0, 50) || agent?.name || 'Agent') : '')
      || (newAgentType === 'shell' ? 'Terminal' : agent?.name || 'Agent');

    const res = await fetch(api('/api/panes'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, title, color: newColor, cwd, claudeSessionId,
        agentType: newAgentType,
        customCommand: newAgentType === 'custom' ? newCustomCommand : undefined,
      }),
    });
    const pane = await res.json();
    setPanes(prev => [...prev, pane]);
    setShowAdd(false);
    setNewTitle('');
    setNewCwd('');
    setNewColor('#6366f1');
    setNewClaudeSession('');
    setNewAgentType('shell');
    setNewAgentMode('new');
    setNewCustomCommand('');
    setSelectedSession(null);
    setSessionSearch('');
  }, [newTitle, newCwd, newColor, newClaudeSession, newAgentType, newAgentMode, newCustomCommand, selectedSession]);

  const closePane = useCallback(async (id: string) => {
    await fetch(api(`/api/panes/${id}`), { method: 'DELETE' });
    setPanes(prev => prev.filter(p => p.id !== id));
    if (maximized === id) setMaximized(null);
    setPoppedOut(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [maximized]);

  const updatePane = useCallback(async (id: string, data: Partial<PaneData>) => {
    await fetch(api(`/api/panes/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setPanes(prev => prev.map(p => p.id === id ? { ...p, ...data } : p));
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setMaximized(prev => prev === id ? null : id);
  }, []);

  // ─── Popout ────────────────────────────────────────────────

  const openPopoutWindow = useCallback((pane: PaneData) => {
    const w = pane.winWidth || 900;
    const h = pane.winHeight || 600;
    const x = pane.winX ?? Math.round(screen.width / 2 - w / 2);
    const y = pane.winY ?? Math.round(screen.height / 2 - h / 2);
    const features = `left=${x},top=${y},width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no`;

    window.open(api(`/terminal/pane/${pane.id}`), `spaces-pane-${pane.id}`, features);
    setPoppedOut(prev => new Set(prev).add(pane.id));

    // Mark in DB
    fetch(api(`/api/panes/${pane.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPopout: true, winX: x, winY: y, winWidth: w, winHeight: h }),
    });
  }, []);

  const handlePopout = useCallback((id: string) => {
    const pane = panes.find(p => p.id === id);
    if (pane) openPopoutWindow(pane);
  }, [panes, openPopoutWindow]);

  // ─── Pop in (return popout to grid) ──────────────────────

  const popIn = useCallback(async (id: string) => {
    // Tell the popout window to close itself
    channelRef.current?.postMessage({ type: 'close-popouts' });
    // Mark as not popped out in DB
    await fetch(api(`/api/panes/${id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPopout: false }),
    });
    setPoppedOut(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // ─── Close all popout windows ─────────────────────────────

  const closeAllPopouts = useCallback(() => {
    if (poppedOut.size > 0) {
      channelRef.current?.postMessage({ type: 'close-popouts' });
      setPoppedOut(new Set());
    }
  }, [poppedOut]);

  // ─── Workspace Operations ──────────────────────────────────

  const switchWorkspace = useCallback(async (wsId: number) => {
    // Close all popout windows first (saves their positions)
    closeAllPopouts();
    await fetch(api('/api/workspaces'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'switch', workspaceId: wsId }),
    });
    setMaximized(null);
    await loadWorkspaces();
    await loadPanes();
    setShowWsPicker(false);
    // Trigger popout restore for the new workspace's panes
    setRestoreGen(prev => prev + 1);
  }, [loadWorkspaces, loadPanes, closeAllPopouts]);

  const saveWorkspaceAs = useCallback(async () => {
    if (!saveAsName.trim() || !activeWorkspace) return;
    await fetch(api('/api/workspaces'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'duplicate', sourceId: activeWorkspace.id, name: saveAsName.trim(), color: saveAsColor }),
    });
    setSaveAsName('');
    setSaveAsColor('#6366f1');
    setShowSaveAs(false);
    await loadWorkspaces();
  }, [saveAsName, saveAsColor, activeWorkspace, loadWorkspaces]);

  const createNewWorkspace = useCallback(async () => {
    const res = await fetch(api('/api/workspaces'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Space', color: '#6366f1' }),
    });
    const ws = await res.json();
    await switchWorkspace(ws.id);
  }, [switchWorkspace]);

  const deleteWorkspace = useCallback(async (wsId: number) => {
    closeAllPopouts();
    await fetch(api(`/api/workspaces/${wsId}`), { method: 'DELETE' });
    await loadWorkspaces();
    await loadPanes();
    setShowWsPicker(false);
  }, [loadWorkspaces, loadPanes, closeAllPopouts]);

  const closeWorkspace = useCallback(() => {
    closeAllPopouts();
    router.push('/');
  }, [closeAllPopouts, router]);

  const renameWorkspace = useCallback(async (wsId: number, name: string) => {
    await fetch(api(`/api/workspaces/${wsId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    setEditingWs(null);
    await loadWorkspaces();
  }, [loadWorkspaces]);

  // ─── Render ────────────────────────────────────────────────

  const visiblePanes = panes.filter(p => !poppedOut.has(p.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={closeWorkspace}
            className="p-1.5 -ml-1 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-md transition-colors"
            title="Close space and go home"
          >
            <Home className="w-4 h-4" />
          </button>
          <div className="w-px h-4 bg-zinc-800" />
          <h1 className="text-sm font-semibold">Spaces</h1>

          {/* Workspace selector */}
          <div ref={wsPickerRef} className="relative">
            <button
              onClick={() => setShowWsPicker(!showWsPicker)}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded-md hover:border-zinc-600 transition-colors"
            >
              {activeWorkspace && (
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: activeWorkspace.color }} />
              )}
              <span className="max-w-[150px] truncate">{activeWorkspace?.name || 'No space'}</span>
              <ChevronDown className="w-3 h-3 text-zinc-500" />
            </button>

            {showWsPicker && (
              <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-zinc-800 border border-zinc-700 rounded-md shadow-xl overflow-hidden">
                <div className="p-2 border-b border-zinc-700/50 text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                  Switch Space
                </div>
                <div className="max-h-[300px] overflow-y-auto">
                  {workspaces.map((ws) => (
                    <div key={ws.id} className="flex items-center gap-2 hover:bg-zinc-700/50 transition-colors group">
                      {editingWs === ws.id ? (
                        <div className="flex items-center gap-1 flex-1 px-3 py-2">
                          <input
                            autoFocus
                            value={editWsName}
                            onChange={(e) => setEditWsName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') renameWorkspace(ws.id, editWsName);
                              if (e.key === 'Escape') setEditingWs(null);
                            }}
                            className="flex-1 bg-transparent border border-zinc-600 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-indigo-400"
                          />
                          <button onClick={() => renameWorkspace(ws.id, editWsName)} className="text-green-400 hover:text-green-300">
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => switchWorkspace(ws.id)}
                            className="flex items-center gap-2 flex-1 px-3 py-2 text-left"
                          >
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ws.color }} />
                            <span className="text-xs text-white truncate flex-1">{ws.name}</span>
                            <span className="text-[10px] text-zinc-500">{ws.paneCount || 0} panes</span>
                            {ws.isActive && <span className="text-[10px] text-indigo-400">active</span>}
                          </button>
                          <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100">
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditingWs(ws.id); setEditWsName(ws.name); }}
                              className="p-1 text-zinc-500 hover:text-white rounded"
                              title="Rename"
                            >
                              <Pencil className="w-2.5 h-2.5" />
                            </button>
                            {!ws.isActive && workspaces.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm(`Delete space "${ws.name}" and all its panes?`)) {
                                    deleteWorkspace(ws.id);
                                  }
                                }}
                                className="p-1 text-zinc-500 hover:text-red-400 rounded"
                                title="Delete"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div className="border-t border-zinc-700/50 p-1.5 flex gap-1">
                  <button
                    onClick={createNewWorkspace}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors flex-1"
                  >
                    <Plus className="w-3 h-3" /> New Empty
                  </button>
                  <button
                    onClick={() => { setShowSaveAs(true); setShowWsPicker(false); }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-white hover:bg-zinc-700 rounded transition-colors flex-1"
                  >
                    <Copy className="w-3 h-3" /> Duplicate Current
                  </button>
                </div>
              </div>
            )}
          </div>

          <span className="text-[11px] text-zinc-500">
            {visiblePanes.length} pane{visiblePanes.length !== 1 ? 's' : ''}
            {poppedOut.size > 0 && ` + ${poppedOut.size} popped out`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={closeWorkspace}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-zinc-700 text-zinc-400 rounded-md hover:text-white hover:border-zinc-600 transition-colors"
            title="Close space and return home"
          >
            <XCircle className="w-3.5 h-3.5" />
            Close
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-500 transition-colors"
          >
          <Plus className="w-3.5 h-3.5" />
          Add Pane
        </button>
        </div>
      </div>

      {/* Save-as dialog */}
      {showSaveAs && (
        <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-3">
          <div className="max-w-md flex items-center gap-2">
            <Save className="w-4 h-4 text-indigo-400 flex-shrink-0" />
            <input
              autoFocus
              type="text"
              placeholder="New space name..."
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveWorkspaceAs()}
              className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500 text-white"
            />
            <ColorPicker value={saveAsColor} onChange={setSaveAsColor} />
            <button
              onClick={saveWorkspaceAs}
              disabled={!saveAsName.trim()}
              className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => setShowSaveAs(false)}
              className="p-1.5 text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Add pane dialog */}
      {showAdd && (
        <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-4">
          <div className="max-w-lg space-y-3">
            <h3 className="text-sm font-semibold">Add Pane</h3>

            {/* Agent type grid */}
            <div>
              <label className="text-[11px] text-zinc-400 mb-1.5 block">Agent</label>
              <div className="grid grid-cols-3 gap-1.5">
                {AGENT_LIST.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => {
                      setNewAgentType(agent.id);
                      setNewAgentMode('new');
                      setSelectedSession(null);
                      setNewClaudeSession('');
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md border text-left transition-colors ${
                      newAgentType === agent.id
                        ? 'border-indigo-500 bg-indigo-600/20 text-white'
                        : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: agent.color }}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">{agent.name}</div>
                      <div className="text-[10px] text-zinc-500 truncate">{agent.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* New / Resume toggle (only for agents that support resume) */}
            {AGENT_TYPES[newAgentType]?.supportsResume && (
              <div className="flex gap-2">
                <button
                  onClick={() => { setNewAgentMode('new'); setSelectedSession(null); setNewClaudeSession(''); }}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    newAgentMode === 'new'
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600'
                  }`}
                >
                  New Session
                </button>
                <button
                  onClick={() => setNewAgentMode('resume')}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                    newAgentMode === 'resume'
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600'
                  }`}
                >
                  Resume Session
                </button>
              </div>
            )}

            {/* Custom command input */}
            {newAgentType === 'custom' && (
              <input
                type="text"
                placeholder="Command to run (e.g. python agent.py)"
                value={newCustomCommand}
                onChange={(e) => setNewCustomCommand(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500 text-white font-mono"
              />
            )}

            <input
              type="text"
              placeholder="Title (optional)"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500 text-white"
            />

            <FolderPicker value={newCwd} onChange={setNewCwd} />

            {/* Session picker for resume mode */}
            {newAgentType === 'claude' && newAgentMode === 'resume' && (
              <div ref={pickerRef} className="relative">
                {selectedSession ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md">
                    <MessageSquare className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-white truncate">
                        {selectedSession.customName || selectedSession.firstPrompt?.slice(0, 60) || 'Untitled'}
                      </div>
                      <div className="text-[10px] text-zinc-500 flex items-center gap-2">
                        <span>{selectedSession.projectName}</span>
                        <span>{selectedSession.messageCount} msgs</span>
                        <span className="font-mono">{selectedSession.sessionId.slice(0, 8)}...</span>
                      </div>
                    </div>
                    <button
                      onClick={() => { setSelectedSession(null); setShowSessionPicker(true); }}
                      className="text-zinc-400 hover:text-white text-xs"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md cursor-text"
                    onClick={() => setShowSessionPicker(true)}
                  >
                    <Search className="w-3.5 h-3.5 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search sessions by name, prompt, or project..."
                      value={sessionSearch}
                      onChange={(e) => { setSessionSearch(e.target.value); setShowSessionPicker(true); }}
                      onFocus={() => setShowSessionPicker(true)}
                      className="flex-1 bg-transparent focus:outline-none text-white placeholder:text-zinc-500"
                    />
                    {newCwd && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setFilterByCwd(!filterByCwd); }}
                        className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                          filterByCwd
                            ? 'border-indigo-500/50 bg-indigo-600/20 text-indigo-400'
                            : 'border-zinc-600 text-zinc-500 hover:text-zinc-400'
                        }`}
                        title={filterByCwd ? 'Showing sessions for this directory — click to show all' : 'Showing all sessions — click to filter by directory'}
                      >
                        {filterByCwd ? newCwd.split('/').pop() : 'All'}
                      </button>
                    )}
                    <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                  </div>
                )}

                {showSessionPicker && !selectedSession && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-[300px] overflow-y-auto bg-zinc-800 border border-zinc-700 rounded-md shadow-xl">
                    {sessionsLoading ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                        <span className="text-xs text-zinc-400 ml-2">Loading sessions...</span>
                      </div>
                    ) : sessions.length === 0 ? (
                      <div className="py-4 px-3 text-xs text-zinc-500 text-center">
                        {sessionSearch ? 'No sessions match your search' : 'No sessions found'}
                      </div>
                    ) : (
                      sessions.map((s) => (
                        <button
                          key={s.sessionId}
                          onClick={() => {
                            setSelectedSession(s);
                            setNewClaudeSession(s.sessionId);
                            if (!newCwd && s.projectPath) setNewCwd(s.projectPath);
                            if (!newTitle) setNewTitle(s.customName || '');
                            setShowSessionPicker(false);
                          }}
                          className="w-full text-left px-3 py-2.5 hover:bg-zinc-700 border-b border-zinc-700/50 last:border-0 transition-colors"
                        >
                          <div className="flex items-start gap-2">
                            <MessageSquare className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-white truncate">
                                {s.customName || s.firstPrompt?.slice(0, 70) || 'Untitled session'}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-indigo-400/70 flex items-center gap-0.5">
                                  <FolderOpen className="w-2.5 h-2.5" />
                                  {s.projectName}
                                </span>
                                <span className="text-[10px] text-zinc-500">{s.messageCount} msgs</span>
                                <span className="text-[10px] text-zinc-500 flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  {new Date(s.modified).toLocaleDateString()}
                                </span>
                                {s.starred && <span className="text-[10px]">★</span>}
                              </div>
                              {s.tags?.length > 0 && (
                                <div className="flex gap-1 mt-1">
                                  {s.tags.map(t => (
                                    <span key={t} className="text-[9px] px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-400">{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-[11px] text-zinc-400 mb-1.5 block">Color</label>
              <ColorPicker value={newColor} onChange={setNewColor} />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={addPane}
                disabled={newAgentType === 'custom' && !newCustomCommand.trim()}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Create
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-sm border border-zinc-700 text-zinc-400 rounded-md hover:text-white hover:border-zinc-600"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Popped-out pane indicators */}
      {poppedOut.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800 bg-zinc-900/50">
          <span className="text-[10px] text-zinc-500">Popped out:</span>
          {panes.filter(p => poppedOut.has(p.id)).map(p => (
            <div key={p.id} className="flex items-center gap-0.5">
              <button
                onClick={() => openPopoutWindow(p)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 rounded-l text-zinc-400 hover:text-white hover:border-zinc-600"
                title="Focus popout window"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
                {p.title}
              </button>
              <button
                onClick={() => popIn(p.id)}
                className="px-1 py-0.5 text-[10px] bg-zinc-800 border border-zinc-700 border-l-0 rounded-r text-zinc-500 hover:text-white hover:border-zinc-600"
                title="Pop back into grid"
              >
                <ArrowLeftToLine className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Terminal grid */}
      {visiblePanes.length === 0 && poppedOut.size === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Layers className="w-16 h-16 mx-auto text-zinc-700" />
            <p className="text-zinc-500">No panes yet.</p>
            <p className="text-zinc-600 text-xs">Add a pane to start a shell, Claude, Codex, Gemini, or any agent.</p>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500 inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add your first pane
            </button>
          </div>
        </div>
      ) : visiblePanes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-zinc-500 text-sm">All panes are popped out to separate windows.</p>
            <button
              onClick={() => setShowAdd(true)}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 rounded-md hover:border-zinc-600 inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add another pane
            </button>
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
                onClose={closePane}
                onUpdate={updatePane}
                isMaximized={maximized === pane.id}
                onToggleMaximize={toggleMaximize}
                onPopout={handlePopout}
                terminalToken={terminalToken}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}
