'use client';

import { useAnalytics } from '@/hooks/use-sessions';
import { ActivityChart } from '@/components/dashboard/activity-chart';
import { ModelUsageChart } from '@/components/dashboard/model-usage-chart';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { Loader2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, Area, AreaChart } from 'recharts';
import { getModelDisplayName } from '@/lib/cost-calculator';
import { formatCost } from '@/lib/utils';

export default function AnalyticsPage() {
  const { data, isLoading } = useAnalytics();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!data) return null;

  // Token usage over time
  const tokenData = (data.dailyModelTokens || []).slice(-30).map((d) => {
    const total = Object.values(d.tokensByModel).reduce((sum, v) => sum + v, 0);
    return {
      date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      tokens: total,
    };
  });

  // Tool call activity
  const toolCallData = (data.dailyActivity || []).slice(-30).map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    toolCalls: d.toolCallCount,
  }));

  // Model breakdown table
  const modelBreakdown = Object.entries(data.modelUsage || {}).map(([model, usage]) => ({
    model: getModelDisplayName(model),
    fullModel: model,
    input: usage.inputTokens,
    output: usage.outputTokens,
    cacheRead: usage.cacheReadInputTokens,
    cacheWrite: usage.cacheCreationInputTokens,
    total: usage.inputTokens + usage.outputTokens + usage.cacheReadInputTokens + usage.cacheCreationInputTokens,
  })).sort((a, b) => b.total - a.total);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Deep insights into your Claude Code usage</p>
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

      {/* Token Usage Over Time */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
        <h3 className="font-semibold mb-4">Token Usage Over Time</h3>
        {tokenData.length === 0 ? (
          <p className="text-sm text-muted-foreground h-[200px] flex items-center justify-center">No token data</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={tokenData}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
              <Tooltip
                formatter={(value) => `${(Number(value) / 1000).toFixed(0)}K tokens`}
                contentStyle={{
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  fontSize: '12px',
                }}
              />
              <Area type="monotone" dataKey="tokens" fill="#6366f1" fillOpacity={0.2} stroke="#6366f1" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Tool Calls Over Time */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
        <h3 className="font-semibold mb-4">Tool Calls Over Time</h3>
        {toolCallData.length === 0 ? (
          <p className="text-sm text-muted-foreground h-[200px] flex items-center justify-center">No tool call data</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={toolCallData}>
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
              <Bar dataKey="toolCalls" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Model Breakdown Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="font-semibold">Model Breakdown</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-4 py-2">Model</th>
                <th className="px-4 py-2 text-right">Input</th>
                <th className="px-4 py-2 text-right">Output</th>
                <th className="px-4 py-2 text-right">Cache Read</th>
                <th className="px-4 py-2 text-right">Cache Write</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {modelBreakdown.map((row) => (
                <tr key={row.fullModel}>
                  <td className="px-4 py-2 font-medium">{row.model}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{formatTokens(row.input)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{formatTokens(row.output)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{formatTokens(row.cacheRead)}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{formatTokens(row.cacheWrite)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.estimatedCost > 0 && (
          <div className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800">
            <p className="text-xs text-muted-foreground">
              Estimated API cost equivalent: <span className="text-zinc-400">{formatCost(data.estimatedCost)}</span>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (!n) return '-';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
