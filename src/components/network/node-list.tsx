'use client';

import { useState } from 'react';
import { useNodes, useRemoveNode, useCheckHealth } from '@/hooks/use-network';
import { NodeAddDialog } from './node-add-dialog';
import { Plus, Trash2, RefreshCw, Globe, Loader2 } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  online: { color: 'text-green-600 dark:text-green-400', bg: 'bg-green-500', label: 'Online' },
  offline: { color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500', label: 'Offline' },
  error: { color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500', label: 'Error' },
  unknown: { color: 'text-zinc-500', bg: 'bg-zinc-400', label: 'Unknown' },
};

export function NodeList() {
  const { data: nodes, isLoading } = useNodes();
  const removeNode = useRemoveNode();
  const checkHealth = useCheckHealth();
  const [showAdd, setShowAdd] = useState(false);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Node
        </button>
        {nodes && nodes.length > 0 && (
          <button
            onClick={() => checkHealth.mutate()}
            disabled={checkHealth.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkHealth.isPending ? 'animate-spin' : ''}`} />
            Check All
          </button>
        )}
      </div>

      {/* Node cards */}
      {nodes && nodes.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {nodes.map((node) => {
            const st = statusConfig[node.status] || statusConfig.unknown;
            return (
              <div
                key={node.id}
                className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${st.bg}`} />
                    <h3 className="font-medium text-sm">{node.name}</h3>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm(`Remove node "${node.name}"? You can re-add it later.`)) {
                        removeNode.mutate(node.id);
                      }
                    }}
                    className="p-1 text-zinc-400 hover:text-red-500 rounded"
                    title="Remove node"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1 text-xs text-zinc-500">
                  <div className="flex items-center gap-1 font-mono truncate" title={node.url}>
                    <Globe className="w-3 h-3 flex-shrink-0" />
                    {node.url}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={st.color}>{st.label}</span>
                    {node.lastSeen && (
                      <span>Last seen {formatRelativeTime(node.lastSeen)}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{node.sessionCount} sessions</span>
                    {node.version && <span>v{node.version}</span>}
                  </div>
                  {node.lastError && node.status !== 'online' && (
                    <div className="text-amber-600 dark:text-amber-400 text-[11px] truncate" title={node.lastError}>
                      {node.lastError}
                    </div>
                  )}
                  <div className="text-[10px] text-zinc-400 font-mono">
                    Key: ...{node.apiKeyHint}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8 text-sm text-zinc-500">
          <Globe className="w-8 h-8 mx-auto mb-2 text-zinc-300 dark:text-zinc-700" />
          <p>No connected nodes.</p>
          <p className="text-xs mt-1">Add a node to see sessions and terminals from other Spaces instances.</p>
        </div>
      )}

      {/* Add dialog */}
      {showAdd && <NodeAddDialog onClose={() => setShowAdd(false)} />}
    </div>
  );
}
