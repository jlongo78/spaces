'use client';

import { useState, useEffect, useRef } from 'react';
import { useSessions, useProjects } from '@/hooks/use-sessions';
import { useNodes } from '@/hooks/use-network';
import { SessionList } from '@/components/sessions/session-list';
import { SessionFilters } from '@/components/sessions/session-filters';
import { Loader2, AlertTriangle, Globe } from 'lucide-react';
import { track } from '@/lib/telemetry';

export default function SessionsPage() {
  const [projectId, setProjectId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('modified');
  const [starred, setStarred] = useState(false);
  const [agentType, setAgentType] = useState('');
  const [page, setPage] = useState(0);
  const [nodeFilter, setNodeFilter] = useState<'local' | 'all'>('all');
  const limit = 30;

  const searchTrackTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!search) return;
    clearTimeout(searchTrackTimer.current);
    searchTrackTimer.current = setTimeout(() => {
      track('sessions_searched');
    }, 1000);
    return () => clearTimeout(searchTrackTimer.current);
  }, [search]);

  const { data: projects } = useProjects();
  const { data: nodes } = useNodes();
  const { data, isLoading } = useSessions({
    projectId: projectId || undefined,
    starred: starred || undefined,
    search: search || undefined,
    agentType: agentType || undefined,
    sortBy,
    offset: page * limit,
    limit,
    nodeFilter,
  });

  const hasNodes = nodes && nodes.length > 0;

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Browse all your agent conversations
        </p>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <SessionFilters
            projects={projects || []}
            projectId={projectId}
            onProjectChange={setProjectId}
            search={search}
            onSearchChange={(s) => { setSearch(s); setPage(0); }}
            sortBy={sortBy}
            onSortChange={setSortBy}
            starred={starred}
            onStarredChange={setStarred}
            agentType={agentType}
            onAgentTypeChange={(t) => { setAgentType(t); setPage(0); }}
          />
        </div>

        {/* Node filter — only show when nodes are configured */}
        {hasNodes && (
          <div className="flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-zinc-500" />
            <select
              value={nodeFilter}
              onChange={(e) => { setNodeFilter(e.target.value as 'local' | 'all'); setPage(0); }}
              className="px-3 py-1.5 text-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="all">All Nodes ({nodes?.length ? nodes.length + 1 : 1})</option>
              <option value="local">Local Only</option>
            </select>
          </div>
        )}
      </div>

      {/* Aggregation errors */}
      {data?.errors && data.errors.length > 0 && (
        <div className="mb-4 flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>
            {data.errors.length} node{data.errors.length !== 1 ? 's' : ''} unreachable:{' '}
            {data.errors.map(e => e.nodeName).join(', ')}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
        </div>
      ) : (
        <>
          <SessionList sessions={data?.sessions || []} />

          {data && data.total > limit && (
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-muted-foreground">
                Showing {page * limit + 1}-{Math.min((page + 1) * limit, data.total)} of {data.total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-md disabled:opacity-50 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * limit >= data.total}
                  className="px-3 py-1.5 border border-zinc-200 dark:border-zinc-800 rounded-md disabled:opacity-50 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
