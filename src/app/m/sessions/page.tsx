'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useSessions, useProjects } from '@/hooks/use-sessions';
import { MobileHeader } from '@/components/mobile/mobile-header';
import { MobileSessionCard } from '@/components/mobile/mobile-session-card';
import { PullToRefresh } from '@/components/mobile/pull-to-refresh';
import { Search, Star, ChevronDown, Loader2 } from 'lucide-react';

export default function MobileSessionsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-[80dvh]">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
      </div>
    }>
      <MobileSessionsInner />
    </Suspense>
  );
}

function MobileSessionsInner() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState(searchParams.get('projectId') || '');
  const [starred, setStarred] = useState(false);
  const [page, setPage] = useState(0);
  const [showProjectFilter, setShowProjectFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const limit = 30;

  const queryClient = useQueryClient();
  const { data: projects } = useProjects();
  const { data, isLoading } = useSessions({
    projectId: projectId || undefined,
    starred: starred || undefined,
    search: search || undefined,
    sortBy: 'modified',
    offset: page * limit,
    limit,
  });

  // Close filter on outside click
  useEffect(() => {
    if (!showProjectFilter) return;
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowProjectFilter(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProjectFilter]);

  const selectedProject = projects?.find(p => String(p.id) === projectId);

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['sessions'] });
  }, [queryClient]);

  return (
    <>
      <MobileHeader title="Sessions" />

      <PullToRefresh onRefresh={handleRefresh}>
      <div className="px-4 py-3 space-y-3">
        {/* Search bar */}
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search sessions..."
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-zinc-600"
          />
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-2">
          {/* Project filter */}
          <div ref={filterRef} className="relative flex-1">
            <button
              onClick={() => setShowProjectFilter(!showProjectFilter)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded-lg w-full"
            >
              <span className="truncate text-zinc-400">
                {selectedProject ? selectedProject.name : 'All projects'}
              </span>
              <ChevronDown className="w-3 h-3 text-zinc-500 ml-auto flex-shrink-0" />
            </button>

            {showProjectFilter && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl">
                <button
                  onClick={() => { setProjectId(''); setShowProjectFilter(false); setPage(0); }}
                  className="w-full text-left px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-700"
                >
                  All projects
                </button>
                {(projects || []).map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setProjectId(String(p.id)); setShowProjectFilter(false); setPage(0); }}
                    className="w-full text-left px-3 py-2.5 text-xs text-zinc-300 hover:bg-zinc-700 truncate"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Starred toggle */}
          <button
            onClick={() => { setStarred(!starred); setPage(0); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border rounded-lg flex-shrink-0 ${
              starred
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400'
            }`}
          >
            <Star className="w-3 h-3" />
            Starred
          </button>
        </div>

        {/* Session list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {(data?.sessions || []).map(session => (
                <MobileSessionCard key={session.id} session={session} />
              ))}
            </div>

            {data?.sessions?.length === 0 && (
              <p className="text-sm text-zinc-500 text-center py-12">No sessions found.</p>
            )}

            {/* Pagination */}
            {data && data.total > limit && (
              <div className="flex items-center justify-between pt-2 text-xs text-zinc-500">
                <span>
                  {page * limit + 1}-{Math.min((page + 1) * limit, data.total)} of {data.total}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 border border-zinc-800 rounded-md disabled:opacity-30"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage(p => p + 1)}
                    disabled={(page + 1) * limit >= data.total}
                    className="px-3 py-1.5 border border-zinc-800 rounded-md disabled:opacity-30"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </PullToRefresh>
    </>
  );
}
