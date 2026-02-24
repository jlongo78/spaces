'use client';

import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAnalytics } from '@/hooks/use-sessions';
import { MobileHeader } from '@/components/mobile/mobile-header';
import { PullToRefresh } from '@/components/mobile/pull-to-refresh';
import { Loader2, MessageSquare, Hash, FolderOpen, Star, GitBranch } from 'lucide-react';
import { formatNumber, formatRelativeTime, truncate } from '@/lib/utils';
import Link from 'next/link';
import type { SessionWithMeta } from '@/types/claude';

export default function MobileDashboard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAnalytics();

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['analytics'] });
  }, [queryClient]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[80dvh]">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <MobileHeader title="Dashboard" />
        <p className="text-red-500 text-sm mt-4">Failed to load dashboard.</p>
      </div>
    );
  }

  if (!data) return null;

  const stats = [
    { label: 'Sessions', value: formatNumber(data.totalSessions), icon: MessageSquare, color: 'text-blue-500' },
    { label: 'Messages', value: formatNumber(data.totalMessages), icon: Hash, color: 'text-green-500' },
    { label: 'Projects', value: String(data.totalProjects), icon: FolderOpen, color: 'text-purple-500' },
  ];

  return (
    <>
      <MobileHeader title="Dashboard" />

      <PullToRefresh onRefresh={handleRefresh}>
      <div className="px-4 py-4 space-y-5">
        {/* Stats row */}
        <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4">
          {stats.map(({ label, value, icon: Icon, color }) => (
            <div
              key={label}
              className="flex-shrink-0 w-28 bg-zinc-900 border border-zinc-800 rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-zinc-400">{label}</span>
                <Icon className={`w-3.5 h-3.5 ${color}`} />
              </div>
              <p className="text-xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        {/* Recent sessions */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent Sessions</h2>
            <Link href="/m/sessions" className="text-xs text-indigo-400">
              View all
            </Link>
          </div>

          {data.recentSessions?.length ? (
            <div className="space-y-2">
              {data.recentSessions.map((session: SessionWithMeta) => (
                <Link
                  key={session.id}
                  href={`/m/sessions/${session.id}`}
                  className="block bg-zinc-900 border border-zinc-800 rounded-lg p-3 active:bg-zinc-800"
                >
                  <div className="flex items-center gap-2 mb-1">
                    {session.starred && <Star className="w-3 h-3 text-amber-500 fill-amber-500 flex-shrink-0" />}
                    <span className="text-sm font-medium truncate">
                      {session.customName || session.summary || truncate(session.firstPrompt, 60)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                    <span className="truncate">{session.projectName}</span>
                    {session.gitBranch && session.gitBranch !== 'HEAD' && (
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-2.5 h-2.5" />
                        {session.gitBranch}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-2.5 h-2.5" />
                      {session.messageCount}
                    </span>
                    <span className="ml-auto flex-shrink-0">
                      {formatRelativeTime(session.modified)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-zinc-500 py-8 text-center">No sessions yet.</p>
          )}
        </div>
      </div>
      </PullToRefresh>
    </>
  );
}
