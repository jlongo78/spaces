'use client';

import { MessageSquare, Hash, FolderOpen } from 'lucide-react';
import { formatNumber } from '@/lib/utils';

interface StatsCardsProps {
  totalSessions: number;
  totalMessages: number;
  totalProjects: number;
  estimatedCost?: number;
}

export function StatsCards({ totalSessions, totalMessages, totalProjects }: StatsCardsProps) {
  const cards = [
    { label: 'Sessions', value: formatNumber(totalSessions), icon: MessageSquare, color: 'text-blue-500' },
    { label: 'Messages', value: formatNumber(totalMessages), icon: Hash, color: 'text-green-500' },
    { label: 'Projects', value: String(totalProjects), icon: FolderOpen, color: 'text-purple-500' },
  ];

  return (
    <div className="grid grid-cols-3 gap-4">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <div
          key={label}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{label}</span>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <p className="text-2xl font-bold mt-2">{value}</p>
        </div>
      ))}
    </div>
  );
}
