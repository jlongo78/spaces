'use client';

import { useState, useRef, useEffect } from 'react';
import { Layers, X, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspaces, useAddSessionToWorkspace, useRemoveSessionFromWorkspace } from '@/hooks/use-sessions';
import type { Workspace } from '@/types/claude';

interface WorkspacePickerProps {
  sessionId: string;
  currentWorkspaces?: Workspace[];
  compact?: boolean;
}

export function WorkspacePicker({ sessionId, currentWorkspaces = [], compact }: WorkspacePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: allWorkspaces } = useWorkspaces();
  const addToWorkspace = useAddSessionToWorkspace();
  const removeFromWorkspace = useRemoveSessionFromWorkspace();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentIds = currentWorkspaces.map(w => w.id);

  return (
    <div ref={ref} className="relative inline-block">
      {/* Current workspaces */}
      <div className="flex items-center gap-1 flex-wrap">
        {currentWorkspaces.map((ws) => (
          <span
            key={ws.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border"
            style={{
              backgroundColor: `${ws.color}15`,
              borderColor: `${ws.color}40`,
              color: ws.color,
            }}
          >
            <Layers className="w-2.5 h-2.5" />
            {ws.name}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeFromWorkspace.mutate({ workspaceId: ws.id, sessionId });
              }}
              className="hover:opacity-70"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}

        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors',
            compact && 'p-1'
          )}
        >
          <Layers className="w-3 h-3" />
          {!compact && 'space'}
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-lg z-50 py-1">
          {(allWorkspaces || []).length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No spaces yet. Create one on the Spaces page.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {(allWorkspaces || []).map((ws) => {
                const isIn = currentIds.includes(ws.id);
                return (
                  <button
                    key={ws.id}
                    onClick={() => {
                      if (isIn) {
                        removeFromWorkspace.mutate({ workspaceId: ws.id, sessionId });
                      } else {
                        addToWorkspace.mutate({ workspaceId: ws.id, sessionId });
                      }
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-left"
                  >
                    <span
                      className="w-3 h-3 rounded flex-shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: `${ws.color}20` }}
                    >
                      {isIn && <Check className="w-2.5 h-2.5" style={{ color: ws.color }} />}
                    </span>
                    <span className="text-xs truncate flex-1">{ws.name}</span>
                    <span className="text-[10px] text-muted-foreground">{ws.sessionCount || 0}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
