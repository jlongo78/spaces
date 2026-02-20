'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { formatRelativeTime, truncate, cn } from '@/lib/utils';
import type { SessionWithMeta, Workspace } from '@/types/claude';
import {
  MessageSquare, Star, GitBranch, Tag, MoreHorizontal,
  Pencil, Layers, Check, X, TagIcon,
} from 'lucide-react';
import {
  useToggleStar, useRenameSession, useAddTag, useBulkAction,
  useWorkspaces, useAddSessionToWorkspace, useTags,
} from '@/hooks/use-sessions';

interface SessionListProps {
  sessions: SessionWithMeta[];
}

export function SessionList({ sessions }: SessionListProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const allSelected = sessions.length > 0 && selected.size === sessions.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sessions.map(s => s.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!sessions.length) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No sessions found</p>
      </div>
    );
  }

  return (
    <div>
      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          sessionIds={Array.from(selected)}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg divide-y divide-zinc-200 dark:divide-zinc-800">
        {/* Header row */}
        <div className="flex items-center gap-3 px-4 py-2 bg-zinc-50 dark:bg-zinc-900/50">
          <button onClick={toggleAll} className="flex-shrink-0">
            <div className={cn(
              'w-4 h-4 rounded border flex items-center justify-center transition-colors',
              allSelected
                ? 'bg-indigo-500 border-indigo-500'
                : 'border-zinc-300 dark:border-zinc-600 hover:border-indigo-400'
            )}>
              {allSelected && <Check className="w-3 h-3 text-white" />}
            </div>
          </button>
          <span className="text-[11px] text-muted-foreground font-medium">
            {selected.size > 0 ? `${selected.size} selected` : `${sessions.length} sessions`}
          </span>
        </div>

        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            isSelected={selected.has(session.id)}
            onToggle={() => toggleOne(session.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Session Row ────────────────────────────────────────────

function SessionRow({ session, isSelected, onToggle }: {
  session: SessionWithMeta;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleStar = useToggleStar();

  return (
    <div className={cn(
      'flex items-start gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors group',
      isSelected && 'bg-indigo-50/50 dark:bg-indigo-950/20'
    )}>
      {/* Checkbox */}
      <button onClick={onToggle} className="mt-0.5 flex-shrink-0">
        <div className={cn(
          'w-4 h-4 rounded border flex items-center justify-center transition-colors',
          isSelected
            ? 'bg-indigo-500 border-indigo-500'
            : 'border-zinc-300 dark:border-zinc-600 hover:border-indigo-400'
        )}>
          {isSelected && <Check className="w-3 h-3 text-white" />}
        </div>
      </button>

      {/* Star */}
      <button
        onClick={(e) => {
          e.preventDefault();
          toggleStar.mutate(session.id);
        }}
        className="mt-0.5 flex-shrink-0"
      >
        <Star
          className={cn('w-4 h-4 transition-colors',
            session.starred
              ? 'text-amber-500 fill-amber-500'
              : 'text-zinc-300 dark:text-zinc-600 hover:text-amber-400'
          )}
        />
      </button>

      {/* Content */}
      <Link href={`/sessions/${session.id}`} className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {session.customName || session.summary || truncate(session.firstPrompt, 100)}
        </p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-indigo-500">{session.projectName}</span>
          {session.gitBranch && session.gitBranch !== 'HEAD' && (
            <span className="flex items-center gap-1">
              <GitBranch className="w-3 h-3" />
              {session.gitBranch}
            </span>
          )}
          <span className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {session.messageCount} msgs
          </span>
        </div>

        {/* Tag + workspace chips */}
        {(session.tags?.length > 0 || session.workspaces?.length > 0) && (
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
            {session.tags?.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300"
              >
                <Tag className="w-2 h-2" />
                {tag}
              </span>
            ))}
            {session.workspaces?.map((ws) => (
              <span
                key={ws.id}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border"
                style={{ backgroundColor: `${ws.color}15`, borderColor: `${ws.color}40`, color: ws.color }}
              >
                <Layers className="w-2 h-2" />
                {ws.name}
              </span>
            ))}
          </div>
        )}
      </Link>

      {/* Time + action menu */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatRelativeTime(session.modified)}
        </span>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <ActionMenu
              session={session}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Action Menu ────────────────────────────────────────────

function ActionMenu({ session, onClose }: { session: SessionWithMeta; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(session.customName || '');
  const [tagging, setTagging] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [pickingWorkspace, setPickingWorkspace] = useState(false);

  const renameSession = useRenameSession();
  const addTag = useAddTag();
  const toggleStar = useToggleStar();
  const { data: workspaces } = useWorkspaces();
  const addToWorkspace = useAddSessionToWorkspace();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 w-52 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg z-50 py-1"
    >
      {/* Rename */}
      {renaming ? (
        <div className="px-3 py-2">
          <input
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                renameSession.mutate({ sessionId: session.id, name: nameValue });
                onClose();
              }
              if (e.key === 'Escape') setRenaming(false);
            }}
            className="w-full text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-400"
            placeholder="Custom name..."
          />
          <p className="text-[10px] text-muted-foreground mt-1">Enter to save, Esc to cancel</p>
        </div>
      ) : (
        <button
          onClick={() => setRenaming(true)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left"
        >
          <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
          Rename
        </button>
      )}

      {/* Star/Unstar */}
      <button
        onClick={() => {
          toggleStar.mutate(session.id);
          onClose();
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left"
      >
        <Star className={cn('w-3.5 h-3.5', session.starred ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground')} />
        {session.starred ? 'Unstar' : 'Star'}
      </button>

      {/* Add tag */}
      {tagging ? (
        <div className="px-3 py-2">
          <input
            autoFocus
            value={tagValue}
            onChange={(e) => setTagValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tagValue.trim()) {
                addTag.mutate({ sessionId: session.id, tagName: tagValue.trim() });
                setTagValue('');
                setTagging(false);
              }
              if (e.key === 'Escape') setTagging(false);
            }}
            className="w-full text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-400"
            placeholder="Tag name..."
          />
        </div>
      ) : (
        <button
          onClick={() => setTagging(true)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left"
        >
          <Tag className="w-3.5 h-3.5 text-muted-foreground" />
          Add Tag
        </button>
      )}

      {/* Add to workspace */}
      {pickingWorkspace ? (
        <div className="max-h-32 overflow-y-auto">
          {(workspaces || []).map((ws) => (
            <button
              key={ws.id}
              onClick={() => {
                addToWorkspace.mutate({ workspaceId: ws.id, sessionId: session.id });
                onClose();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left"
            >
              <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: ws.color }} />
              {ws.name}
            </button>
          ))}
          {(!workspaces || workspaces.length === 0) && (
            <p className="px-3 py-2 text-[10px] text-muted-foreground">No workspaces yet</p>
          )}
        </div>
      ) : (
        <button
          onClick={() => setPickingWorkspace(true)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left"
        >
          <Layers className="w-3.5 h-3.5 text-muted-foreground" />
          Add to Workspace
        </button>
      )}
    </div>
  );
}

// ─── Bulk Action Bar ────────────────────────────────────────

function BulkBar({ count, sessionIds, onClear }: {
  count: number;
  sessionIds: string[];
  onClear: () => void;
}) {
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);

  const bulkAction = useBulkAction();
  const { data: workspaces } = useWorkspaces();

  return (
    <div className="mb-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-3 flex items-center gap-3 flex-wrap">
      <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
        {count} selected
      </span>

      <div className="flex items-center gap-2 flex-wrap">
        {/* Star */}
        <button
          onClick={() => {
            bulkAction.mutate({ sessionIds, action: 'star' });
            onClear();
          }}
          className="px-3 py-1 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
        >
          <Star className="w-3 h-3" /> Star
        </button>

        {/* Unstar */}
        <button
          onClick={() => {
            bulkAction.mutate({ sessionIds, action: 'unstar' });
            onClear();
          }}
          className="px-3 py-1 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
        >
          <Star className="w-3 h-3" /> Unstar
        </button>

        {/* Tag */}
        {showTagInput ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagValue.trim()) {
                  bulkAction.mutate({ sessionIds, action: 'tag', tagName: tagValue.trim() });
                  setTagValue('');
                  setShowTagInput(false);
                  onClear();
                }
                if (e.key === 'Escape') setShowTagInput(false);
              }}
              className="px-2 py-1 text-xs border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-indigo-400 w-28"
              placeholder="Tag name..."
            />
            <button onClick={() => setShowTagInput(false)} className="text-muted-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowTagInput(true)}
            className="px-3 py-1 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
          >
            <Tag className="w-3 h-3" /> Tag
          </button>
        )}

        {/* Workspace */}
        {showWorkspacePicker ? (
          <div className="flex items-center gap-1 flex-wrap">
            {(workspaces || []).map((ws) => (
              <button
                key={ws.id}
                onClick={() => {
                  bulkAction.mutate({ sessionIds, action: 'workspace', workspaceId: ws.id });
                  setShowWorkspacePicker(false);
                  onClear();
                }}
                className="px-2 py-1 text-xs bg-white dark:bg-zinc-900 border rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
                style={{ borderColor: `${ws.color}60` }}
              >
                <span className="w-2 h-2 rounded" style={{ backgroundColor: ws.color }} />
                {ws.name}
              </button>
            ))}
            <button onClick={() => setShowWorkspacePicker(false)} className="text-muted-foreground">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowWorkspacePicker(true)}
            className="px-3 py-1 text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 flex items-center gap-1"
          >
            <Layers className="w-3 h-3" /> Workspace
          </button>
        )}
      </div>

      <button
        onClick={onClear}
        className="ml-auto text-xs text-muted-foreground hover:text-foreground"
      >
        Clear selection
      </button>
    </div>
  );
}
