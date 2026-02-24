'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { DailyActivity } from '@/types/claude';

interface ActivityChartProps {
  dailyActivity: DailyActivity[];
}

export function ActivityChart({ dailyActivity }: ActivityChartProps) {
  const data = (dailyActivity || []).slice(-30).map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    messages: d.messageCount,
    sessions: d.sessionCount,
  }));

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-4">Daily Activity (Last 30 Days)</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground h-[200px] flex items-center justify-center">No activity data</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                fontSize: '12px',
              }}
            />
            <Bar dataKey="messages" fill="#6366f1" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
