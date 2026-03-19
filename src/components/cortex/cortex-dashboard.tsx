'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { TYPE_COLORS, SENSITIVITY_COLORS } from './constants';

interface LobeInfo {
  count: number;
  sizeBytes: number;
  label: string;
}

interface UsageInfo {
  distillation: {
    input_tokens: number;
    output_tokens: number;
    calls: number;
    estimated_cost_usd: number;
    last_updated: string;
  };
  by_model: Record<string, { calls: number; estimated_cost_usd: number }>;
}

interface StatusData {
  enabled: boolean;
  status: string;
  embedding_provider: string;
  embedding_dimensions: number;
  distillation: boolean;
  lobes: Record<string, LobeInfo>;
  totalCount: number;
  totalSizeBytes: number;
  usage: UsageInfo | null;
  graph: { entities: number; edges: number };
  quality: {
    coverage_score: number;
    type_distribution: Record<string, number>;
    avg_confidence: number;
    stale_count: number;
    sensitivity_counts: Record<string, number>;
    top_accessed: Array<{ text: string; type: string; access_count: number }>;
  } | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function BarChart({ items, maxValue }: { items: { label: string; value: number; color: string }[]; maxValue: number }) {
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 w-24 text-right truncate" title={item.label}>{item.label}</span>
          <div className="flex-1 h-3 bg-white/[0.03] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(2, (item.value / Math.max(maxValue, 1)) * 100)}%`,
                backgroundColor: item.color,
              }}
            />
          </div>
          <span className="text-[10px] text-gray-400 w-14 text-right tabular-nums">{item.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color || 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

const LOBE_COLORS = [
  '#7c3aed', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#14b8a6', '#22c55e', '#eab308', '#f97316',
];

const TYPE_HEX: Record<string, string> = {
  decision: '#3b82f6', pattern: '#22c55e', preference: '#ec4899',
  error_fix: '#f59e0b', context: '#6b7280', code_pattern: '#06b6d4',
  command: '#f97316', conversation: '#64748b', summary: '#8b5cf6',
};

export function CortexDashboard() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(api('/api/cortex/status'))
      .then(r => r.json())
      .then(d => { if (d.enabled) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading dashboard...</div>;
  if (!data) return <div className="p-6 text-sm text-gray-500">Cortex is not active.</div>;

  const lobeEntries = Object.entries(data.lobes).sort((a, b) => b[1].count - a[1].count);
  const maxCount = Math.max(...lobeEntries.map(([, l]) => l.count), 1);
  const maxSize = Math.max(...lobeEntries.map(([, l]) => l.sizeBytes), 1);
  const usage = data.usage;
  const dist = usage?.distillation;

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Knowledge Units"
          value={data.totalCount.toLocaleString()}
          sub={`across ${lobeEntries.length} lobes`}
          color="text-purple-400"
        />
        <StatCard
          label="Storage"
          value={formatBytes(data.totalSizeBytes)}
          sub={`${data.embedding_provider} (${data.embedding_dimensions}d)`}
        />
        <StatCard
          label="Coverage"
          value={data.quality ? data.quality.coverage_score.toFixed(2) : '—'}
          sub={data.quality ? `${Math.round(data.quality.coverage_score * 100)}% distilled` : 'no data'}
          color={data.quality
            ? data.quality.coverage_score > 0.7 ? 'text-green-400'
              : data.quality.coverage_score > 0.3 ? 'text-amber-400'
              : 'text-red-400'
            : 'text-gray-500'}
        />
        <StatCard
          label="Distillation"
          value={dist ? `$${dist.estimated_cost_usd.toFixed(2)}` : 'Off'}
          sub={dist ? `${dist.calls.toLocaleString()} calls` : data.distillation ? 'No API key' : 'Disabled'}
          color={dist ? 'text-amber-400' : 'text-gray-500'}
        />
      </div>

      {/* Lobe breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* By knowledge count */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
          <h3 className="text-xs font-medium text-gray-400 mb-3">Knowledge by Lobe</h3>
          <BarChart
            items={lobeEntries.map(([key, lobe], i) => ({
              label: lobe.label || key,
              value: lobe.count,
              color: LOBE_COLORS[i % LOBE_COLORS.length],
            }))}
            maxValue={maxCount}
          />
        </div>

        {/* By disk size */}
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
          <h3 className="text-xs font-medium text-gray-400 mb-3">Storage by Lobe</h3>
          <BarChart
            items={lobeEntries.map(([key, lobe], i) => ({
              label: lobe.label || key,
              value: lobe.sizeBytes,
              color: LOBE_COLORS[i % LOBE_COLORS.length],
            }))}
            maxValue={maxSize}
          />
          <div className="mt-2 flex justify-between text-[10px] text-gray-600">
            <span>Smallest: {formatBytes(Math.min(...lobeEntries.map(([, l]) => l.sizeBytes)))}</span>
            <span>Total: {formatBytes(data.totalSizeBytes)}</span>
          </div>
        </div>
      </div>

      {/* Quality panels */}
      {data.quality && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Type distribution */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
            <h3 className="text-xs font-medium text-gray-400 mb-3">Type Distribution</h3>
            <BarChart
              items={Object.entries(data.quality.type_distribution)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => ({
                  label: type.replace('_', ' '),
                  value: count,
                  color: TYPE_HEX[type] || '#7c3aed',
                }))}
              maxValue={Math.max(...Object.values(data.quality.type_distribution), 1)}
            />
          </div>

          {/* Lobe health */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
            <h3 className="text-xs font-medium text-gray-400 mb-3">Lobe Health</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-500">Stale units</span>
                <span className={data.quality.stale_count > 10 ? 'text-amber-400' : 'text-gray-300'}>
                  {data.quality.stale_count}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-500">Avg confidence</span>
                <span className="text-gray-300">{data.quality.avg_confidence.toFixed(2)}</span>
              </div>
              {data.quality.top_accessed.length > 0 && (
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Top accessed</div>
                  <div className="text-[11px] text-gray-400 truncate">
                    &ldquo;{data.quality.top_accessed[0].text}&rdquo;
                  </div>
                </div>
              )}
              {data.quality.sensitivity_counts && (
                <div>
                  <div className="text-[10px] text-gray-500 mb-1">Sensitivity</div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(data.quality.sensitivity_counts).map(([level, count]) => (
                      <span key={level} className={`text-[9px] px-1.5 py-0.5 rounded ${SENSITIVITY_COLORS[level] || SENSITIVITY_COLORS.internal}`}>
                        {count} {level}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Distillation detail */}
      {dist && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
          <h3 className="text-xs font-medium text-gray-400 mb-3">Distillation Activity</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-[10px] text-gray-500">API Calls</div>
              <div className="text-sm font-medium text-white tabular-nums">{dist.calls.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500">Input Tokens</div>
              <div className="text-sm font-medium text-white tabular-nums">{(dist.input_tokens / 1000).toFixed(1)}K</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500">Output Tokens</div>
              <div className="text-sm font-medium text-white tabular-nums">{(dist.output_tokens / 1000).toFixed(1)}K</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500">Estimated Cost</div>
              <div className="text-sm font-medium text-amber-400 tabular-nums">${dist.estimated_cost_usd.toFixed(4)}</div>
            </div>
          </div>
          {dist.last_updated && (
            <div className="mt-2 text-[10px] text-gray-600">
              Last distillation: {new Date(dist.last_updated).toLocaleString()}
            </div>
          )}
          {usage.by_model && Object.keys(usage.by_model).length > 0 && (
            <div className="mt-3 border-t border-white/[0.04] pt-3">
              <div className="text-[10px] text-gray-500 mb-2">By Model</div>
              {Object.entries(usage.by_model).map(([model, stats]) => (
                <div key={model} className="flex items-center justify-between text-[10px]">
                  <span className="text-gray-400 font-mono">{model}</span>
                  <span className="text-gray-500">{stats.calls} calls &middot; ${stats.estimated_cost_usd.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* System info */}
      <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
        <h3 className="text-xs font-medium text-gray-400 mb-3">System</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-gray-500">Status</span>
            <span className="text-green-400">{data.status}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Embedding</span>
            <span className="text-gray-300">{data.embedding_provider} ({data.embedding_dimensions}d)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Distillation</span>
            <span className={data.distillation ? 'text-green-400' : 'text-gray-600'}>{data.distillation ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Lobes</span>
            <span className="text-gray-300">{lobeEntries.length} active</span>
          </div>
        </div>
      </div>
    </div>
  );
}
