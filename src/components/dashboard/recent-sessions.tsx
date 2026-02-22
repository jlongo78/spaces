'use client';

import Link from 'next/link';
import { formatRelativeTime, truncate } from '@/lib/utils';
import type { SessionWithMeta } from '@/types/claude';
import { MessageSquare, Star, GitBranch } from 'lucide-react';

interface RecentSessionsProps {
  sessions: SessionWithMeta[];
}

export function RecentSessions({ sessions }: RecentSessionsProps) {
  if (!sessions?.length) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-6">
        <h2 className="font-semibold mb-4">Recent Sessions</h2>
        <p className="text-sm text-muted-foreground">No sessions found.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <h2 className="font-semibold">Recent Sessions</h2>
      </div>
      <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {sessions.map((session) => (
          <Link
            key={session.id}
            href={`/sessions/${session.id}`}
            className="flex items-start gap-3 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {session.starred && <Star className="w-3 h-3 text-amber-500 fill-amber-500 flex-shrink-0" />}
                <p className="text-sm font-medium truncate">
                  {session.customName || session.summary || truncate(session.firstPrompt, 80)}
                </p>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="truncate">{session.projectName}</span>
                {session.gitBranch && (
                  <span className="flex items-center gap-1">
                    <GitBranch className="w-3 h-3" />
                    {session.gitBranch}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  {session.messageCount}
                </span>
              </div>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatRelativeTime(session.modified)}
            </span>
          </Link>
        ))}
      </div>
      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
        <Link href="/sessions" className="text-sm text-indigo-500 hover:text-indigo-600">
          View all sessions
        </Link>
      </div>
    </div>
  );
}
