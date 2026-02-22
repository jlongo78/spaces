'use client';

import { Search, Star, ArrowUpDown } from 'lucide-react';
import type { Project } from '@/types/claude';
import { cn } from '@/lib/utils';

interface SessionFiltersProps {
  projects: Project[];
  projectId: string;
  onProjectChange: (id: string) => void;
  search: string;
  onSearchChange: (search: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
  starred: boolean;
  onStarredChange: (starred: boolean) => void;
}

export function SessionFilters({
  projects,
  projectId,
  onProjectChange,
  search,
  onSearchChange,
  sortBy,
  onSortChange,
  starred,
  onStarredChange,
}: SessionFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search sessions..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-200 dark:border-zinc-800 rounded-md bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
        />
      </div>

      <select
        value={projectId}
        onChange={(e) => onProjectChange(e.target.value)}
        className="px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-800 rounded-md bg-white dark:bg-zinc-900"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value)}
        className="px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-800 rounded-md bg-white dark:bg-zinc-900"
      >
        <option value="modified">Last Modified</option>
        <option value="created">Created</option>
        <option value="messages">Message Count</option>
        <option value="name">Name</option>
      </select>

      <button
        onClick={() => onStarredChange(!starred)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-2 text-sm border rounded-md transition-colors',
          starred
            ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
            : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
        )}
      >
        <Star className={cn('w-3.5 h-3.5', starred && 'fill-amber-500')} />
        Starred
      </button>
    </div>
  );
}
