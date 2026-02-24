'use client';

import { useProjects } from '@/hooks/use-sessions';
import { MobileHeader } from '@/components/mobile/mobile-header';
import { FolderOpen, MessageSquare, Clock, Loader2 } from 'lucide-react';
import { formatRelativeTime, formatNumber } from '@/lib/utils';
import Link from 'next/link';

export default function MobileProjectsPage() {
  const { data: projects, isLoading } = useProjects();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[80dvh]">
        <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <>
      <MobileHeader title="Projects" />

      <div className="px-4 py-4 space-y-2">
        {(projects || []).map(project => (
          <Link
            key={project.id}
            href={`/m/sessions?projectId=${project.id}`}
            className="block bg-zinc-900 border border-zinc-800 rounded-lg p-3.5 active:bg-zinc-800"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-indigo-950 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold truncate">{project.name}</h3>
                <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{project.path}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-2.5 text-[11px] text-zinc-500 pl-12">
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {formatNumber(project.sessionCount)} sessions
              </span>
              {project.lastActivity && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatRelativeTime(project.lastActivity)}
                </span>
              )}
            </div>
          </Link>
        ))}

        {(!projects || projects.length === 0) && (
          <div className="text-center py-16 text-zinc-500">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No projects found.</p>
          </div>
        )}
      </div>
    </>
  );
}
