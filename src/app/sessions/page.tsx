'use client';

import { useState } from 'react';
import { useSessions, useProjects } from '@/hooks/use-sessions';
import { SessionList } from '@/components/sessions/session-list';
import { SessionFilters } from '@/components/sessions/session-filters';
import { Loader2 } from 'lucide-react';

export default function SessionsPage() {
  const [projectId, setProjectId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('modified');
  const [starred, setStarred] = useState(false);
  const [page, setPage] = useState(0);
  const limit = 30;

  const { data: projects } = useProjects();
  const { data, isLoading } = useSessions({
    projectId: projectId || undefined,
    starred: starred || undefined,
    search: search || undefined,
    sortBy,
    offset: page * limit,
    limit,
  });

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Browse all your Claude Code conversations
        </p>
      </div>

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
      />

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
