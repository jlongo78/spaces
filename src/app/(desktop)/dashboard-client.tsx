'use client';

import { useAnalytics } from '@/hooks/use-sessions';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { RecentSessions } from '@/components/dashboard/recent-sessions';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { ModelUsageChart } from '@/components/dashboard/model-usage-chart';
import { Loader2 } from 'lucide-react';

export default function DashboardClient() {
  const { data, isLoading, error } = useAnalytics();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-500">Failed to load dashboard. Make sure at least one agent data directory exists (~/.claude/, ~/.codex/, or ~/.gemini/).</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Your agent activity at a glance</p>
      </div>

      <StatsCards
        totalSessions={data.totalSessions}
        totalMessages={data.totalMessages}
        totalProjects={data.totalProjects}
        estimatedCost={data.estimatedCost}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ActivityChart dailyActivity={data.dailyActivity} />
        <ModelUsageChart modelUsage={data.modelUsage} />
      </div>

      <RecentSessions sessions={data.recentSessions} />
    </div>
  );
}
