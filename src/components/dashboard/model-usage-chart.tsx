'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import type { ModelUsage } from '@/types/claude';
import { getModelDisplayName } from '@/lib/cost-calculator';

interface ModelUsageChartProps {
  modelUsage: Record<string, ModelUsage>;
}

const COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'];

export function ModelUsageChart({ modelUsage }: ModelUsageChartProps) {
  const data = Object.entries(modelUsage || {}).map(([model, usage]) => ({
    name: getModelDisplayName(model),
    tokens: usage.inputTokens + usage.outputTokens,
  })).sort((a, b) => b.tokens - a.tokens);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-4">Model Usage</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground h-[200px] flex items-center justify-center">No model data</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="tokens"
              nameKey="name"
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => {
                const v = Number(value);
                if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M tokens`;
                if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K tokens`;
                return `${v} tokens`;
              }}
              contentStyle={{
                background: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                fontSize: '12px',
              }}
            />
            <Legend formatter={(value) => <span className="text-xs">{value}</span>} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
