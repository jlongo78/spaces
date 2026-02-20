'use client';

import { useState, useEffect, useRef, useCallback, use } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession, useMessages, useToggleStar, useUpdateNotes, useRenameSession } from '@/hooks/use-sessions';
import { MessageRenderer } from '@/components/viewer/message-renderer';
import { ChatInput } from '@/components/viewer/chat-input';
import { TagPicker } from '@/components/common/tag-picker';
import { WorkspacePicker } from '@/components/common/workspace-picker';
import { formatDateTime, truncate } from '@/lib/utils';
import {
  ArrowLeft,
  Star,
  GitBranch,
  MessageSquare,
  Clock,
  FolderOpen,
  Loader2,
  ChevronsDown,
  ChevronsUp,
  StickyNote,
  Hash,
  X,
  Pencil,
  Check,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { track } from '@/lib/telemetry';

export default function SessionViewerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // ─── State ─────────────────────────────────────────────
  const [allMessages, setAllMessages] = useState<any[]>([]);
  const [loadedPages, setLoadedPages] = useState(0);
  const [showSidebar, setShowSidebar] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesValue, setNotesValue] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const limit = 50;

  const scrollRef = useRef<HTMLDivElement>(null);

  // ─── Data ──────────────────────────────────────────────
  const { data: session, isLoading: sessionLoading } = useSession(id);
  const { data: messagesData, isLoading: messagesLoading } = useMessages(id, loadedPages * limit, limit);
  const toggleStar = useToggleStar();
  const updateNotes = useUpdateNotes();
  const renameSession = useRenameSession();
  const queryClient = useQueryClient();

  const refreshMessages = useCallback(() => {
    // Reset to reload all messages from the start
    setTimeout(() => {
      setLoadedPages(0);
      setAllMessages([]);
      queryClient.invalidateQueries({ queryKey: ['messages', id] });
      queryClient.invalidateQueries({ queryKey: ['session', id] });
    }, 1500); // Wait for Claude CLI to finish writing to JSONL
  }, [id, queryClient]);

  // ─── Accumulate messages ───────────────────────────────
  useEffect(() => {
    if (messagesData?.messages && messagesData.messages.length > 0) {
      if (loadedPages === 0) {
        setAllMessages(messagesData.messages);
      } else {
        setAllMessages(prev => [...prev, ...messagesData.messages]);
      }
    }
  }, [messagesData, loadedPages]);

  // ─── Track session view ──────────────────────────────
  useEffect(() => {
    track('session_viewed');
  }, [id]);

  // ─── Initialize notes ─────────────────────────────────
  useEffect(() => {
    if (session?.notes) setNotesValue(session.notes);
  }, [session?.notes]);

  // ─── Scroll handlers ──────────────────────────────────
  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const loadMore = useCallback(() => {
    if (!messagesLoading && messagesData?.hasMore) {
      setLoadedPages(p => p + 1);
    }
  }, [messagesLoading, messagesData?.hasMore]);

  // ─── Keyboard shortcuts ───────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotesOpen(false);
        setRenaming(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Loading ──────────────────────────────────────────
  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-8 space-y-2">
        <p className="text-red-500">Session not found</p>
        <Link href="/sessions" className="text-indigo-500 text-sm">Back to sessions</Link>
      </div>
    );
  }

  const title = session.customName || session.summary || truncate(session.firstPrompt, 120);
  const messages = allMessages;
  const totalMessages = messagesData?.total || session.messageCount;
  const hasMore = messagesData?.hasMore ?? true;

  // Cast to get extended session data
  const sessionData = session as typeof session & { tagObjects?: any[]; workspaces?: any[] };

  // ─── Message type counts for sidebar ──────────────────
  const typeCounts = messages.reduce((acc: Record<string, number>, m: any) => {
    acc[m.type] = (acc[m.type] || 0) + 1;
    return acc;
  }, {});

  // ─── Tool usage summary for sidebar ───────────────────
  const toolCounts: Record<string, number> = {};
  for (const msg of messages) {
    if (msg.type === 'assistant') {
      const blocks = msg.message?.content;
      if (Array.isArray(blocks)) {
        for (const b of blocks) {
          if (b.type === 'tool_use' && b.name) {
            toolCounts[b.name] = (toolCounts[b.name] || 0) + 1;
          }
        }
      }
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ─── Main conversation area ─────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-2.5 flex-shrink-0 z-10">
          <div className="flex items-center gap-3">
            <Link href="/sessions" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>

            <button
              onClick={() => { toggleStar.mutate(session.id); track('session_starred'); }}
              className="flex-shrink-0"
            >
              <Star
                className={cn('w-4 h-4 transition-colors', session.starred ? 'text-amber-500 fill-amber-500' : 'text-zinc-300 hover:text-amber-400')}
              />
            </button>

            <div className="flex-1 min-w-0">
              {renaming ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameSession.mutate({ sessionId: session.id, name: nameValue });
                        setRenaming(false);
                      }
                      if (e.key === 'Escape') setRenaming(false);
                    }}
                    className="text-sm font-semibold bg-transparent border border-indigo-400 rounded px-2 py-0.5 focus:outline-none w-full max-w-md"
                    placeholder="Custom session name..."
                  />
                  <button
                    onClick={() => {
                      renameSession.mutate({ sessionId: session.id, name: nameValue });
                      setRenaming(false);
                    }}
                    className="text-green-500 hover:text-green-600"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setRenaming(false)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 group">
                  <h1 className="text-sm font-semibold truncate">{title}</h1>
                  <button
                    onClick={() => {
                      setNameValue(session.customName || '');
                      setRenaming(true);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
                    title="Rename session"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              )}
              <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1 font-medium text-indigo-500">
                  <FolderOpen className="w-3 h-3" />
                  {session.projectName}
                </span>
                {session.gitBranch && session.gitBranch !== 'HEAD' && (
                  <span className="flex items-center gap-1">
                    <GitBranch className="w-3 h-3" />
                    {session.gitBranch}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  {totalMessages}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDateTime(session.created)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setNotesOpen(!notesOpen)}
                className={cn(
                  'p-1.5 rounded-md transition-colors text-muted-foreground',
                  notesOpen ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                )}
                title="Notes"
              >
                <StickyNote className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowSidebar(!showSidebar)}
                className={cn(
                  'p-1.5 rounded-md transition-colors text-muted-foreground',
                  showSidebar ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
                )}
                title="Toggle sidebar"
              >
                <Hash className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tags + Workspaces bar */}
          <div className="flex items-center gap-3 mt-2">
            <TagPicker
              sessionId={session.id}
              currentTags={session.tags || []}
              tagObjects={sessionData.tagObjects}
            />
            <span className="text-zinc-300 dark:text-zinc-700">|</span>
            <WorkspacePicker
              sessionId={session.id}
              currentWorkspaces={sessionData.workspaces}
            />
          </div>
        </div>

        {/* Notes panel */}
        {notesOpen && (
          <div className="border-b border-zinc-200 dark:border-zinc-800 bg-amber-50/50 dark:bg-amber-950/10 px-4 py-3 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <StickyNote className="w-3 h-3" /> Notes
              </span>
              <button onClick={() => setNotesOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            </div>
            <textarea
              value={notesValue}
              onChange={(e) => setNotesValue(e.target.value)}
              onBlur={() => updateNotes.mutate({ sessionId: session.id, notes: notesValue })}
              placeholder="Add notes about this session..."
              className="w-full h-20 text-sm bg-transparent border border-amber-200 dark:border-amber-900/50 rounded-md px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto py-6 px-6 space-y-6">
            {messagesLoading && messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                <span className="text-sm text-muted-foreground">Loading conversation...</span>
              </div>
            ) : (
              <>
                {/* Message count indicator */}
                <div className="text-center">
                  <span className="text-[11px] text-muted-foreground bg-zinc-100 dark:bg-zinc-800 px-3 py-1 rounded-full">
                    Showing {messages.length} of {totalMessages} messages
                  </span>
                </div>

                {messages.map((msg, i) => (
                  <MessageRenderer
                    key={msg.uuid || `msg-${i}`}
                    message={msg}
                    isLast={i === messages.length - 1}
                  />
                ))}

                {hasMore && (
                  <div className="text-center py-4">
                    <button
                      onClick={loadMore}
                      disabled={messagesLoading}
                      className="px-5 py-2.5 text-sm bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
                    >
                      {messagesLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                      Load more ({totalMessages - messages.length} remaining)
                    </button>
                  </div>
                )}

                {!hasMore && messages.length > 0 && (
                  <div className="text-center py-4">
                    <span className="text-xs text-muted-foreground">End of conversation</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Chat input */}
        <ChatInput
          sessionId={id}
          projectPath={session.projectPath}
          onMessageSent={refreshMessages}
        />

        {/* Scroll controls */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-20" style={{ marginRight: showSidebar ? '260px' : '0' }}>
          <button
            onClick={scrollToTop}
            className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            title="Scroll to top"
          >
            <ChevronsUp className="w-4 h-4" />
          </button>
          <button
            onClick={scrollToBottom}
            className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            title="Scroll to bottom"
          >
            <ChevronsDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ─── Right sidebar ──────────────────────────────── */}
      {showSidebar && (
        <div className="w-[260px] border-l border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 flex-shrink-0 overflow-y-auto">
          <div className="p-4 space-y-5">
            {/* Session info */}
            <div>
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Session</h3>
              <div className="space-y-1.5 text-xs">
                <InfoRow label="ID" value={session.sessionId.slice(0, 8)} mono />
                <InfoRow label="Created" value={formatDateTime(session.created)} />
                <InfoRow label="Modified" value={formatDateTime(session.modified)} />
                <InfoRow label="Messages" value={String(totalMessages)} />
                {session.projectPath && <InfoRow label="Path" value={session.projectPath} />}
              </div>
            </div>

            {/* Conversation breakdown */}
            <div>
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Breakdown</h3>
              <div className="space-y-1">
                {typeCounts['user'] && (
                  <StatBar label="Your messages" count={typeCounts['user']} total={messages.length} color="bg-blue-500" />
                )}
                {typeCounts['assistant'] && (
                  <StatBar label="Claude responses" count={typeCounts['assistant']} total={messages.length} color="bg-indigo-500" />
                )}
                {typeCounts['system'] && (
                  <StatBar label="System" count={typeCounts['system']} total={messages.length} color="bg-zinc-400" />
                )}
              </div>
            </div>

            {/* Tool usage */}
            {Object.keys(toolCounts).length > 0 && (
              <div>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Tools Used ({Object.values(toolCounts).reduce((a, b) => a + b, 0)})
                </h3>
                <div className="space-y-1">
                  {Object.entries(toolCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tool, count]) => (
                      <div key={tool} className="flex items-center justify-between text-xs">
                        <span className="font-mono text-muted-foreground truncate">{tool}</span>
                        <span className="text-muted-foreground bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[10px] font-medium">{count}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Workspaces */}
            {sessionData.workspaces && sessionData.workspaces.length > 0 && (
              <div>
                <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Workspaces</h3>
                <div className="space-y-1">
                  {sessionData.workspaces.map((ws: any) => (
                    <div key={ws.id} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: ws.color }} />
                      <span>{ws.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* File path */}
            <div>
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Source File</h3>
              <p className="text-[10px] font-mono text-muted-foreground break-all leading-relaxed">{session.fullPath}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-muted-foreground flex-shrink-0">{label}</span>
      <span className={cn('text-right truncate', mono && 'font-mono')} title={value}>{value}</span>
    </div>
  );
}

function StatBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-0.5">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{count}</span>
      </div>
      <div className="h-1 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
