'use client';

import Link from 'next/link';
import { Star, MessageSquare, GitBranch, Clock } from 'lucide-react';
import { formatRelativeTime, truncate } from '@/lib/utils';
import type { SessionWithMeta } from '@/types/claude';

interface MobileSessionCardProps {
  session: SessionWithMeta;
}

export function MobileSessionCard({ session }: MobileSessionCardProps) {
  const title = session.customName || session.summary || truncate(session.firstPrompt, 80);

  return (
    <Link
      href={`/m/sessions/${session.id}`}
      className="block bg-zinc-900 border border-zinc-800 rounded-lg p-3.5 active:bg-zinc-800 transition-colors"
    >
      <div className="flex items-start gap-2">
        {session.starred && (
          <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{title}</p>
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-500">
            <span className="truncate max-w-[120px] text-indigo-400/70">{session.projectName}</span>
            {session.gitBranch && session.gitBranch !== 'HEAD' && (
              <span className="flex items-center gap-1">
                <GitBranch className="w-2.5 h-2.5" />
                <span className="truncate max-w-[80px]">{session.gitBranch}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <MessageSquare className="w-2.5 h-2.5" />
              {session.messageCount}
            </span>
            <span className="flex items-center gap-1 ml-auto flex-shrink-0">
              <Clock className="w-2.5 h-2.5" />
              {formatRelativeTime(session.modified)}
            </span>
          </div>
          {session.tags && session.tags.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {session.tags.map((tag: string) => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
