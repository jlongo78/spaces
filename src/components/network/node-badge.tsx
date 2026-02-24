'use client';

const statusColors: Record<string, string> = {
  online: '#22c55e',
  offline: '#ef4444',
  error: '#f59e0b',
  unknown: '#71717a',
};

interface NodeBadgeProps {
  name: string;
  status?: string;
  className?: string;
}

export function NodeBadge({ name, status = 'unknown', className = '' }: NodeBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 ${className}`}>
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: statusColors[status] || statusColors.unknown }}
      />
      {name}
    </span>
  );
}
