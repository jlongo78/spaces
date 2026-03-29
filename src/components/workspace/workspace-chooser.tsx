'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Plus, Loader2, Terminal, Search, ChevronDown, ChevronRight,
  Layers, Home, Globe, AlertCircle, LayoutGrid, List, Monitor,
  Users, Zap, Clock, Filter, X, Orbit, Settings2, Wand2,
} from 'lucide-react';
import { ProjectWizard } from '@/components/wizard/project-wizard';
import dynamic from 'next/dynamic';
import type { Workspace } from '@/types/claude';
import { api } from '@/lib/api';
import { LobeSettings } from '@/components/cortex/lobe-settings';
import type { RemoteNode, RemoteError, Template } from './universe-types';
import { matchesSearch } from './universe-utils';

const UniverseView = dynamic(
  () => import('@/components/workspace/universe-view'),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center bg-[#07070f]">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
          <span className="text-xs text-zinc-500">Loading universe...</span>
        </div>
      </div>
    ),
  },
);

// ─── Types ─────────────────────────────────────────────────

type ViewMode = 'grid' | 'list' | 'universe';
type FilterSource = 'all' | 'local' | 'network';

interface WorkspaceChooserProps {
  workspaces: Workspace[];
  wsLoading: boolean;
  templates: Template[];
  hasNetwork: boolean;
  hasCortex?: boolean;
  remoteNodes: RemoteNode[];
  remoteErrors: RemoteError[];
  remoteLoading: boolean;
  basePath: string;
  onSwitchWorkspace: (wsId: number) => void;
  onCreateWorkspace: () => void;
  onSelectTemplate: (template: Template) => void;
  onOpenRemote: (nodeId: string, wsId: number) => void;
  onGoHome: () => void;
}

// ─── Component ─────────────────────────────────────────────

class UniverseErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; onError: () => void }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export function WorkspaceChooser({
  workspaces,
  wsLoading,
  templates,
  hasNetwork,
  hasCortex,
  remoteNodes,
  remoteErrors,
  remoteLoading,
  basePath,
  onSwitchWorkspace,
  onCreateWorkspace,
  onSelectTemplate,
  onOpenRemote,
  onGoHome,
}: WorkspaceChooserProps) {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filterSource, setFilterSource] = useState<FilterSource>('all');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showWizard, setShowWizard] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [universeError, setUniverseError] = useState(false);
  const [universeToast, setUniverseToast] = useState<string | null>(null);

  // Keyboard shortcut: Ctrl+K or / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !(e.target instanceof HTMLInputElement))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearch('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ─── Filtered data ────────────────────────────────────

  const filteredLocal = useMemo(() => {
    if (filterSource === 'network') return [];
    return workspaces.filter(ws => matchesSearch(ws.name, search));
  }, [workspaces, search, filterSource]);

  const filteredRemote = useMemo(() => {
    if (filterSource === 'local' || !hasNetwork) return [];
    return remoteNodes
      .map(node => ({
        ...node,
        workspaces: node.workspaces.filter(ws => matchesSearch(ws.name, search)),
      }))
      .filter(node => node.workspaces.length > 0);
  }, [remoteNodes, search, filterSource, hasNetwork]);

  const filteredTemplates = useMemo(() => {
    return templates.filter(t => matchesSearch(t.name, search));
  }, [templates, search]);

  const totalRemoteSpaces = filteredRemote.reduce((sum, n) => sum + n.workspaces.length, 0);
  const totalSpaces = filteredLocal.length + totalRemoteSpaces;
  const hasResults = totalSpaces > 0 || filteredTemplates.length > 0;

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 flex-shrink-0">
        <button
          onClick={onGoHome}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-md transition-colors"
        >
          <Home className="w-3.5 h-3.5" />
          Home
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'text-white bg-zinc-800' : 'text-zinc-600 hover:text-zinc-400'}`}
            title="Grid view"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'text-white bg-zinc-800' : 'text-zinc-600 hover:text-zinc-400'}`}
            title="List view"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              if (universeError) return;
              setViewMode('universe');
            }}
            className={`p-1.5 rounded transition-colors ${
              viewMode === 'universe'
                ? 'text-white bg-zinc-800'
                : universeError
                  ? 'text-zinc-800 cursor-not-allowed'
                  : 'text-zinc-600 hover:text-zinc-400'
            }`}
            title={universeError ? '3D view unavailable' : 'Universe view'}
          >
            <Orbit className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main content */}
      {viewMode === 'universe' ? (
        <div className="flex-1 min-h-0">
          <UniverseErrorBoundary onError={() => { setUniverseError(true); setViewMode('grid'); setUniverseToast('3D view unavailable — using grid view'); setTimeout(() => setUniverseToast(null), 4000); }}>
            <UniverseView
              workspaces={workspaces}
              wsLoading={wsLoading}
              hasNetwork={hasNetwork}
              remoteNodes={remoteNodes}
              remoteErrors={remoteErrors}
              remoteLoading={remoteLoading}
              filterSource={filterSource}
              onSwitchWorkspace={onSwitchWorkspace}
              onCreateWorkspace={onCreateWorkspace}
              onOpenRemote={onOpenRemote}
            />
          </UniverseErrorBoundary>
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="text-center mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${basePath}/spaces_icon.png`} alt="Spaces" className="w-14 h-14 mx-auto mb-3" />
            <h1 className="text-xl font-bold mb-1">Spaces</h1>
            <p className="text-zinc-500 text-xs">
              {totalSpaces} space{totalSpaces !== 1 ? 's' : ''}
              {hasNetwork && remoteNodes.length > 0 && (
                <span> across {1 + remoteNodes.length} node{remoteNodes.length !== 0 ? 's' : ''}</span>
              )}
            </p>
          </div>

          {/* Search + Filter bar */}
          <div className="flex items-center gap-2 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search spaces...  (/ or Ctrl+K)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-8 py-2.5 text-sm bg-zinc-900 border border-zinc-800 rounded-lg focus:outline-none focus:border-zinc-600 text-white placeholder:text-zinc-600"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {hasNetwork && (
              <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden text-xs flex-shrink-0">
                {(['all', 'local', 'network'] as FilterSource[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilterSource(f)}
                    className={`px-3 py-2.5 capitalize transition-colors ${
                      filterSource === f
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          {wsLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            </div>
          ) : !hasResults && search ? (
            <div className="text-center py-16">
              <Search className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
              <p className="text-sm text-zinc-500">No spaces matching &ldquo;{search}&rdquo;</p>
              <button onClick={() => setSearch('')} className="text-xs text-indigo-400 hover:text-indigo-300 mt-2">
                Clear search
              </button>
            </div>
          ) : (
            <>
              {/* ── Local Spaces ──────────────────────────────── */}
              {(filterSource !== 'network') && (
                <Section
                  id="local"
                  icon={<Monitor className="w-3.5 h-3.5" />}
                  title="Local Spaces"
                  count={filteredLocal.length}
                  collapsed={collapsedSections.has('local')}
                  onToggle={() => toggleSection('local')}
                >
                  {filteredLocal.length === 0 ? (
                    <div className="py-6 text-center text-xs text-zinc-600">
                      {search ? 'No local spaces match your search' : 'No workspaces yet'}
                    </div>
                  ) : viewMode === 'grid' ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {filteredLocal.map(ws => (
                        <WorkspaceCard key={ws.id} ws={ws} hasCortex={hasCortex} onClick={() => onSwitchWorkspace(ws.id)} />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {filteredLocal.map(ws => (
                        <WorkspaceRow key={ws.id} ws={ws} onClick={() => onSwitchWorkspace(ws.id)} />
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* ── Create new ────────────────────────────────── */}
              <div className="flex justify-center my-4">
                <button
                  onClick={onCreateWorkspace}
                  className="flex items-center gap-2 px-4 py-2 text-xs border border-dashed border-zinc-700 text-zinc-500 rounded-lg hover:text-white hover:border-zinc-500 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Workspace
                </button>
                <button
                  onClick={() => setShowWizard(true)}
                  className="flex items-center gap-2 px-4 py-2 text-xs border border-dashed border-indigo-700/50 text-indigo-400/70 rounded-lg hover:text-indigo-300 hover:border-indigo-500/50 transition-colors"
                >
                  <Wand2 className="w-3.5 h-3.5" />
                  Plan a Project
                </button>
              </div>

              {/* ── Network Spaces ────────────────────────────── */}
              {hasNetwork && filterSource !== 'local' && (
                <>
                  {remoteLoading && filteredRemote.length === 0 && (
                    <div className="flex items-center justify-center gap-2 py-6">
                      <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                      <span className="text-xs text-zinc-500">Discovering network nodes...</span>
                    </div>
                  )}

                  {filteredRemote.map(node => (
                    <Section
                      key={node.nodeId}
                      id={`node-${node.nodeId}`}
                      icon={<Globe className="w-3.5 h-3.5 text-emerald-500/70" />}
                      title={node.nodeName}
                      count={node.workspaces.length}
                      badge="network"
                      collapsed={collapsedSections.has(`node-${node.nodeId}`)}
                      onToggle={() => toggleSection(`node-${node.nodeId}`)}
                    >
                      {viewMode === 'grid' ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                          {node.workspaces.map(ws => (
                            <WorkspaceCard
                              key={`${node.nodeId}-${ws.id}`}
                              ws={ws}
                              remote
                              nodeName={node.nodeName}
                              onClick={() => onOpenRemote(node.nodeId, ws.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          {node.workspaces.map(ws => (
                            <WorkspaceRow
                              key={`${node.nodeId}-${ws.id}`}
                              ws={ws}
                              remote
                              nodeName={node.nodeName}
                              onClick={() => onOpenRemote(node.nodeId, ws.id)}
                            />
                          ))}
                        </div>
                      )}
                    </Section>
                  ))}

                  {/* Node errors */}
                  {remoteErrors.length > 0 && (
                    <div className="mt-2 mb-4 space-y-1">
                      {remoteErrors.map(err => (
                        <div key={err.nodeId} className="flex items-center gap-2 px-3 py-1.5 text-[10px] text-zinc-600 bg-zinc-900/50 rounded">
                          <AlertCircle className="w-3 h-3 text-red-500/50 flex-shrink-0" />
                          <span className="truncate">{err.nodeName}: {err.error}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ── Templates ─────────────────────────────────── */}
              {filteredTemplates.length > 0 && (
                <Section
                  id="templates"
                  icon={<Layers className="w-3.5 h-3.5 text-violet-500/70" />}
                  title="Quick Start Templates"
                  count={filteredTemplates.length}
                  collapsed={collapsedSections.has('templates')}
                  onToggle={() => toggleSection('templates')}
                >
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {filteredTemplates.map(tmpl => (
                      <button
                        key={tmpl.id}
                        onClick={() => onSelectTemplate(tmpl)}
                        className="flex items-center gap-2.5 p-3 bg-zinc-900/40 border border-zinc-800/50 rounded-lg hover:border-violet-500/30 hover:bg-zinc-800/30 transition-all text-left group"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white/10"
                          style={{ backgroundColor: tmpl.color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium text-zinc-300 truncate">{tmpl.name}</div>
                          <div className="text-[10px] text-zinc-600 mt-0.5 truncate">
                            {tmpl.paneCount} pane{tmpl.paneCount !== 1 ? 's' : ''}
                            {tmpl.description && <span className="ml-1">&middot; {tmpl.description}</span>}
                          </div>
                        </div>
                        <Zap className="w-3 h-3 text-zinc-700 group-hover:text-violet-400 transition-colors flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </>
          )}

          {/* Bottom padding */}
          <div className="h-8" />
        </div>
      </div>
      )}

      {/* WebGL failure toast */}
      {universeToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs text-zinc-300 shadow-lg">
          {universeToast}
        </div>
      )}

      <ProjectWizard
        isOpen={showWizard}
        onClose={() => setShowWizard(false)}
        onLaunch={(wsId) => {
          setShowWizard(false);
          onSwitchWorkspace(wsId);
        }}
      />
    </div>
  );
}

// ─── Section wrapper ───────────────────────────────────────

function Section({
  id,
  icon,
  title,
  count,
  badge,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  title: string;
  count: number;
  badge?: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-1 py-2 text-left group"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-zinc-600" />
        ) : (
          <ChevronDown className="w-3 h-3 text-zinc-600" />
        )}
        {icon}
        <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">
          {title}
        </span>
        <span className="text-[10px] text-zinc-600 tabular-nums">{count}</span>
        {badge && (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400/70 font-medium">
            {badge}
          </span>
        )}
      </button>
      {!collapsed && <div className="mt-1">{children}</div>}
    </div>
  );
}

// ─── Grid card ─────────────────────────────────────────────

function WorkspaceCard({
  ws,
  remote,
  nodeName,
  hasCortex,
  onClick,
}: {
  ws: Workspace;
  remote?: boolean;
  nodeName?: string;
  hasCortex?: boolean;
  onClick: () => void;
}) {
  const [showLobe, setShowLobe] = useState(false);

  return (
    <div
      className={`
        relative flex flex-col rounded-lg border text-left transition-all group
        ${remote
          ? 'bg-zinc-900/30 border-zinc-800/40 hover:border-emerald-500/30 hover:bg-zinc-800/20'
          : 'bg-zinc-900 border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/50'
        }
        ${showLobe ? 'border-zinc-600' : ''}
      `}
    >
      <button onClick={onClick} className="p-3.5 text-left">
        <div className="flex items-start gap-2.5">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5 ring-1 ring-white/5"
            style={{ backgroundColor: ws.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate leading-tight">{ws.name}</div>
            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1">
                <Terminal className="w-2.5 h-2.5" />
                {ws.paneCount || 0}
              </span>
              {ws.collaboration && (
                <span className="flex items-center gap-0.5 text-blue-400/60">
                  <Users className="w-2.5 h-2.5" />
                </span>
              )}
              {ws.isActive && (
                <span className="flex items-center gap-1 text-indigo-400/80">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                  active
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
      {remote && (
        <div className="absolute top-2 right-2">
          <Globe className="w-3 h-3 text-zinc-700 group-hover:text-emerald-500/50 transition-colors" />
        </div>
      )}
      {!remote && hasCortex && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowLobe(!showLobe); }}
          className={`absolute top-2 right-2 p-1 rounded transition-colors ${
            showLobe ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-700 hover:text-zinc-400'
          }`}
          title="Knowledge lobe settings"
        >
          <Settings2 className="w-3 h-3" />
        </button>
      )}
      {showLobe && (
        <div className="px-3.5 pb-3.5 border-t border-zinc-800/50 pt-3">
          <LobeSettings workspaceId={ws.id} workspaceName={ws.name} />
        </div>
      )}
    </div>
  );
}

// ─── List row ──────────────────────────────────────────────

function WorkspaceRow({
  ws,
  remote,
  nodeName,
  onClick,
}: {
  ws: Workspace;
  remote?: boolean;
  nodeName?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors group
        ${remote
          ? 'hover:bg-zinc-800/30'
          : 'hover:bg-zinc-800/50'
        }
      `}
    >
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-white/5"
        style={{ backgroundColor: ws.color }}
      />
      <span className="text-sm text-white truncate flex-1 min-w-0">{ws.name}</span>
      {ws.collaboration && (
        <Users className="w-3 h-3 text-blue-400/50 flex-shrink-0" />
      )}
      {ws.isActive && (
        <span className="flex items-center gap-1 text-[10px] text-indigo-400/70 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          active
        </span>
      )}
      <span className="text-[10px] text-zinc-600 tabular-nums flex-shrink-0">
        {ws.paneCount || 0} pane{(ws.paneCount || 0) !== 1 ? 's' : ''}
      </span>
      {remote && (
        <Globe className="w-3 h-3 text-zinc-700 flex-shrink-0" />
      )}
      <ChevronRight className="w-3 h-3 text-zinc-700 group-hover:text-zinc-500 transition-colors flex-shrink-0" />
    </button>
  );
}
