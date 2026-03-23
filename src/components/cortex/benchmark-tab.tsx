'use client';

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { FlaskConical, ChevronDown, ChevronRight } from 'lucide-react';
import { useBenchmarkRuns, useBenchmarkRun, useBenchmarkLobes } from '@/hooks/use-benchmark';

interface BenchmarkRun {
  id: string;
  timestamp: string;
  model: string;
  preset: string;
  task_count: number;
  config: string;
}

interface BenchmarkRunSummary {
  runId: string;
  timestamp: string;
  model: string;
  preset: string;
  taskCount: number;
  avgTokenDelta: number;
  avgTokenDeltaPercent: number;
  avgQualityWithout: number;
  avgQualityWith: number;
  avgQualityImprovement: number;
  avgRetrievalRelevance: number;
  avgRetrievalLatencyMs: number;
}

interface CategoryBreakdown {
  category: string;
  taskCount: number;
  avgTokenDeltaPercent: number;
  avgQualityWithout: number;
  avgQualityWith: number;
  avgRetrievalRelevance: number;
  hitRate: number;
}

interface BenchmarkTaskResult {
  id: string;
  run_id: string;
  task_id: string;
  category: string;
  difficulty: string;
  status: string;
  tokens_without_input: number | null;
  tokens_without_output: number | null;
  tokens_with_input: number | null;
  tokens_with_output: number | null;
  tokens_delta: number | null;
  tokens_delta_percent: number | null;
  injection_tokens: number | null;
  quality_without: number | null;
  quality_with: number | null;
  quality_improvement: number | null;
  judge_confidence: number | null;
  retrieval_count: number | null;
  retrieval_avg_relevance: number | null;
  retrieval_latency_ms: number | null;
  duration_without_ms: number | null;
  duration_with_ms: number | null;
}

interface BenchmarkLobeScore {
  id: string;
  run_id: string;
  lobe_id: string;
  lobe_name: string;
  overall_score: number | null;
  token_savings: number | null;
  quality_improvement: number | null;
  coverage_score: number | null;
  category_strengths: string | null;
  badge_tier: string | null;
  marketplace_ready: number | null;
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color || 'text-white'}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  );
}

const CHART_TOOLTIP_STYLE = {
  background: '#0f0f11',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '0.5rem',
  fontSize: '11px',
  color: '#d1d5db',
};

function deltaColor(pct: number): string {
  if (pct < -10) return '#22c55e';
  if (pct < 0) return '#86efac';
  if (pct < 5) return '#f59e0b';
  return '#ef4444';
}

function TaskRow({ result }: { result: BenchmarkTaskResult }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/[0.05] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-gray-500">
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
        <span className="text-xs text-gray-300 font-mono flex-1 truncate" title={result.task_id}>
          {result.task_id}
        </span>
        <span className="text-[10px] text-gray-600 w-20">{result.category}</span>
        <span className="text-[10px] text-gray-600 w-12">{result.difficulty}</span>
        <span
          className="text-[10px] tabular-nums w-16 text-right"
          style={{ color: deltaColor(result.tokens_delta_percent ?? 0) }}
        >
          {result.tokens_delta_percent != null
            ? `${result.tokens_delta_percent > 0 ? '+' : ''}${result.tokens_delta_percent.toFixed(1)}%`
            : '—'}
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums w-20 text-right">
          {result.quality_with != null ? result.quality_with.toFixed(2) : '—'}
          {' / '}
          {result.quality_without != null ? result.quality_without.toFixed(2) : '—'}
        </span>
      </button>
      {open && (
        <div className="px-8 pb-3 pt-1 grid grid-cols-2 md:grid-cols-4 gap-3 bg-white/[0.01] border-t border-white/[0.05]">
          <div>
            <div className="text-[9px] text-gray-600 uppercase mb-0.5">Tokens without</div>
            <div className="text-xs text-gray-300 tabular-nums">
              {result.tokens_without_input ?? '—'} in / {result.tokens_without_output ?? '—'} out
            </div>
          </div>
          <div>
            <div className="text-[9px] text-gray-600 uppercase mb-0.5">Tokens with</div>
            <div className="text-xs text-gray-300 tabular-nums">
              {result.tokens_with_input ?? '—'} in / {result.tokens_with_output ?? '—'} out
            </div>
          </div>
          <div>
            <div className="text-[9px] text-gray-600 uppercase mb-0.5">Injection</div>
            <div className="text-xs text-gray-300 tabular-nums">{result.injection_tokens ?? '—'} tokens</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-600 uppercase mb-0.5">Retrieval</div>
            <div className="text-xs text-gray-300 tabular-nums">
              {result.retrieval_count ?? 0} hits
              {result.retrieval_avg_relevance != null
                ? ` · ${result.retrieval_avg_relevance.toFixed(3)} rel`
                : ''}
              {result.retrieval_latency_ms != null
                ? ` · ${result.retrieval_latency_ms.toFixed(0)}ms`
                : ''}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-gray-600 uppercase mb-0.5">Quality improvement</div>
            <div
              className="text-xs tabular-nums"
              style={{
                color:
                  (result.quality_improvement ?? 0) > 0
                    ? '#22c55e'
                    : (result.quality_improvement ?? 0) < 0
                    ? '#ef4444'
                    : '#6b7280',
              }}
            >
              {result.quality_improvement != null
                ? `${result.quality_improvement > 0 ? '+' : ''}${result.quality_improvement.toFixed(3)}`
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-gray-600 uppercase mb-0.5">Judge confidence</div>
            <div className="text-xs text-gray-300 tabular-nums">
              {result.judge_confidence != null ? result.judge_confidence.toFixed(2) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-gray-600 uppercase mb-0.5">Duration without</div>
            <div className="text-xs text-gray-300 tabular-nums">
              {result.duration_without_ms != null ? `${result.duration_without_ms.toFixed(0)}ms` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-gray-600 uppercase mb-0.5">Duration with</div>
            <div className="text-xs text-gray-300 tabular-nums">
              {result.duration_with_ms != null ? `${result.duration_with_ms.toFixed(0)}ms` : '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BadgePill({ tier }: { tier: string | null }) {
  if (!tier) return null;
  const colors: Record<string, string> = {
    gold: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    silver: 'bg-gray-400/20 text-gray-300 border-gray-400/30',
    bronze: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  };
  const cls = colors[tier.toLowerCase()] || 'bg-purple-500/20 text-purple-300 border-purple-500/30';
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-medium uppercase ${cls}`}>
      {tier}
    </span>
  );
}

export function BenchmarkTab() {
  const { data: runsData, isLoading: runsLoading } = useBenchmarkRuns();
  const runs: BenchmarkRun[] = runsData?.runs ?? [];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // Default to latest run once loaded
  const effectiveRunId = selectedRunId ?? runs[0]?.id ?? null;

  const { data: runDetail, isLoading: detailLoading } = useBenchmarkRun(effectiveRunId);
  const { data: lobesData } = useBenchmarkLobes();

  const summary: BenchmarkRunSummary | null = runDetail?.summary ?? null;
  const categories: CategoryBreakdown[] = runDetail?.categories ?? [];
  const results: BenchmarkTaskResult[] = runDetail?.results ?? [];
  const lobes: BenchmarkLobeScore[] = lobesData?.lobes ?? [];

  const noData = !runsLoading && runs.length === 0;

  if (runsLoading) {
    return <div className="p-6 text-sm text-gray-500">Loading benchmark data...</div>;
  }

  if (noData) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-gray-600">
        <FlaskConical className="w-10 h-10" />
        <p className="text-sm text-center max-w-xs">
          No benchmark data yet.{' '}
          <span className="text-gray-500 font-mono text-xs">npm run benchmark</span>
          {' '}to generate results.
        </p>
      </div>
    );
  }

  const tokenDeltaChartData = categories.map(c => ({
    name: c.category,
    delta: parseFloat(c.avgTokenDeltaPercent.toFixed(1)),
  }));

  const qualityChartData = categories.map(c => ({
    name: c.category,
    without: parseFloat(c.avgQualityWithout.toFixed(3)),
    with: parseFloat(c.avgQualityWith.toFixed(3)),
  }));

  const hitRateChartData = [...categories]
    .sort((a, b) => b.hitRate - a.hitRate)
    .map(c => ({
      name: c.category,
      hitRate: parseFloat((c.hitRate * 100).toFixed(1)),
    }));

  return (
    <div className="p-6 max-w-5xl space-y-6">
      {/* Run selector */}
      <div className="flex items-center gap-3">
        <label className="text-[11px] text-gray-500 shrink-0">Run</label>
        <select
          value={effectiveRunId ?? ''}
          onChange={e => setSelectedRunId(e.target.value || null)}
          className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-gray-300 focus:outline-none focus:border-purple-500/50"
        >
          {runs.map((r: BenchmarkRun) => (
            <option key={r.id} value={r.id}>
              {new Date(r.timestamp).toLocaleString()} — {r.model} ({r.preset}, {r.task_count} tasks)
            </option>
          ))}
        </select>
      </div>

      {/* Overview stat cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard
            label="Avg Token Delta"
            value={
              summary.avgTokenDeltaPercent != null
                ? `${summary.avgTokenDeltaPercent > 0 ? '+' : ''}${summary.avgTokenDeltaPercent.toFixed(1)}%`
                : '—'
            }
            sub="vs baseline"
            color={
              summary.avgTokenDeltaPercent < 0
                ? 'text-green-400'
                : summary.avgTokenDeltaPercent < 5
                ? 'text-amber-400'
                : 'text-red-400'
            }
          />
          <StatCard
            label="Quality (with)"
            value={summary.avgQualityWith.toFixed(2)}
            sub="avg LLM judge score"
            color="text-purple-400"
          />
          <StatCard
            label="Quality (without)"
            value={summary.avgQualityWithout.toFixed(2)}
            sub="baseline"
          />
          <StatCard
            label="Tasks"
            value={summary.taskCount.toString()}
            sub={`${categories.length} categories`}
          />
          <StatCard
            label="Avg Retrieval"
            value={
              summary.avgRetrievalLatencyMs
                ? `${summary.avgRetrievalLatencyMs.toFixed(0)}ms`
                : '—'
            }
            sub={
              summary.avgRetrievalRelevance
                ? `${summary.avgRetrievalRelevance.toFixed(3)} relevance`
                : 'relevance'
            }
          />
        </div>
      )}

      {detailLoading && (
        <div className="text-sm text-gray-500">Loading run details...</div>
      )}

      {/* Category breakdown table */}
      {categories.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <h3 className="text-xs font-medium text-gray-400">Category Breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.05]">
                  <th className="px-4 py-2 text-left text-[10px] text-gray-500 uppercase tracking-wider">Category</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Tasks</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Token Delta</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Quality w/o</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Quality with</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Hit Rate</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Relevance</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat, i) => (
                  <tr
                    key={cat.category}
                    className={`border-b border-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}
                  >
                    <td className="px-4 py-2 text-gray-300">{cat.category}</td>
                    <td className="px-4 py-2 text-right text-gray-400 tabular-nums">{cat.taskCount}</td>
                    <td
                      className="px-4 py-2 text-right tabular-nums font-medium"
                      style={{ color: deltaColor(cat.avgTokenDeltaPercent) }}
                    >
                      {cat.avgTokenDeltaPercent > 0 ? '+' : ''}
                      {cat.avgTokenDeltaPercent.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400 tabular-nums">
                      {cat.avgQualityWithout.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-300 tabular-nums font-medium">
                      {cat.avgQualityWith.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400 tabular-nums">
                      {(cat.hitRate * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400 tabular-nums">
                      {cat.avgRetrievalRelevance.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Charts row */}
      {categories.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Token delta by category */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
            <h3 className="text-xs font-medium text-gray-400 mb-3">Token Delta % by Category</h3>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={tokenDeltaChartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v: any) => [`${v > 0 ? '+' : ''}${v}%`, 'Token delta']}
                />
                <Bar dataKey="delta" radius={[2, 2, 0, 0]}>
                  {tokenDeltaChartData.map((entry, i) => (
                    <Cell key={i} fill={deltaColor(entry.delta)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Quality comparison */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
            <h3 className="text-xs font-medium text-gray-400 mb-3">Quality Score by Category</h3>
            <div className="flex items-center gap-4 mb-2">
              <span className="flex items-center gap-1 text-[10px] text-gray-500">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#6b7280' }} />
                Without
              </span>
              <span className="flex items-center gap-1 text-[10px] text-gray-500">
                <span className="w-2 h-2 rounded-sm inline-block" style={{ background: '#7c3aed' }} />
                With Cortex
              </span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={qualityChartData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Bar dataKey="without" fill="#4b5563" radius={[2, 2, 0, 0]} />
                <Bar dataKey="with" fill="#7c3aed" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Hit rate */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 md:col-span-2">
            <h3 className="text-xs font-medium text-gray-400 mb-3">Knowledge Retrieval Hit Rate %</h3>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart
                data={hitRateChartData}
                layout="vertical"
                margin={{ top: 4, right: 4, bottom: 4, left: 60 }}
              >
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 10, fill: '#6b7280' }}
                  width={56}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={(v: any) => [`${v}%`, 'Hit rate']}
                />
                <Bar dataKey="hitRate" fill="#06b6d4" radius={[0, 2, 2, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Lobe scores */}
      {lobes.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.05]">
            <h3 className="text-xs font-medium text-gray-400">Lobe Scores</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.05]">
                  <th className="px-4 py-2 text-left text-[10px] text-gray-500 uppercase tracking-wider">Lobe</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Overall</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Token Savings</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Quality +</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Coverage</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Badge</th>
                  <th className="px-4 py-2 text-right text-[10px] text-gray-500 uppercase tracking-wider">Marketplace</th>
                </tr>
              </thead>
              <tbody>
                {lobes.map((lobe, i) => (
                  <tr
                    key={lobe.id}
                    className={`border-b border-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}
                  >
                    <td className="px-4 py-2">
                      <div className="text-gray-300">{lobe.lobe_name}</div>
                      <div className="text-[9px] text-gray-600 font-mono">{lobe.lobe_id}</div>
                    </td>
                    <td className="px-4 py-2 text-right text-purple-400 tabular-nums font-medium">
                      {lobe.overall_score != null ? lobe.overall_score.toFixed(2) : '—'}
                    </td>
                    <td
                      className="px-4 py-2 text-right tabular-nums"
                      style={{ color: (lobe.token_savings ?? 0) > 0 ? '#22c55e' : '#6b7280' }}
                    >
                      {lobe.token_savings != null
                        ? `${lobe.token_savings > 0 ? '+' : ''}${lobe.token_savings.toFixed(1)}%`
                        : '—'}
                    </td>
                    <td
                      className="px-4 py-2 text-right tabular-nums"
                      style={{ color: (lobe.quality_improvement ?? 0) > 0 ? '#22c55e' : '#6b7280' }}
                    >
                      {lobe.quality_improvement != null
                        ? `${lobe.quality_improvement > 0 ? '+' : ''}${lobe.quality_improvement.toFixed(3)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-400 tabular-nums">
                      {lobe.coverage_score != null ? lobe.coverage_score.toFixed(2) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <BadgePill tier={lobe.badge_tier} />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {lobe.marketplace_ready ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20">
                          Ready
                        </span>
                      ) : (
                        <span className="text-[9px] text-gray-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Task results */}
      {results.length > 0 && (
        <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
            <h3 className="text-xs font-medium text-gray-400">Task Results</h3>
            <span className="text-[10px] text-gray-600">{results.length} tasks</span>
          </div>
          <div className="px-4 py-2">
            {/* Column headers */}
            <div className="flex items-center gap-3 px-3 py-1 mb-1">
              <span className="w-3.5" />
              <span className="text-[9px] text-gray-600 uppercase tracking-wider flex-1">Task ID</span>
              <span className="text-[9px] text-gray-600 uppercase tracking-wider w-20">Category</span>
              <span className="text-[9px] text-gray-600 uppercase tracking-wider w-12">Diff</span>
              <span className="text-[9px] text-gray-600 uppercase tracking-wider w-16 text-right">Token %</span>
              <span className="text-[9px] text-gray-600 uppercase tracking-wider w-20 text-right">Quality w/w</span>
            </div>
            <div className="space-y-1">
              {results.map(r => (
                <TaskRow key={r.id} result={r} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
