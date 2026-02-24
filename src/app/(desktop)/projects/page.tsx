'use client';

import { useProjects } from '@/hooks/use-sessions';
import { FolderOpen, MessageSquare, Clock, Loader2 } from 'lucide-react';
import { formatRelativeTime, formatNumber } from '@/lib/utils';
import Link from 'next/link';

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Auto-detected from your agent session history
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(projects || []).map((project) => (
          <Link
            key={project.id}
            href={`/sessions?projectId=${project.id}`}
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center flex-shrink-0">
                <FolderOpen className="w-5 h-5 text-indigo-500" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">{project.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{project.path}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
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
      </div>

      {(!projects || projects.length === 0) && (
        <div className="text-center py-20 text-muted-foreground">
          <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No projects found. Start using an agent to see projects here.</p>
        </div>
      )}
    </div>
  );
}
