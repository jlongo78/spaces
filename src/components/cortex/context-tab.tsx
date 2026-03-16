'use client';

import { useState } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

const INTENT_COLORS: Record<string, string> = {
  debugging: 'text-red-400',
  architecture: 'text-blue-400',
  onboarding: 'text-green-400',
  policy: 'text-purple-400',
  'how-to': 'text-amber-400',
  review: 'text-pink-400',
  security: 'text-red-500',
  general: 'text-gray-400',
};

const TYPE_COLORS: Record<string, string> = {
  decision: 'bg-blue-500/20 text-blue-400',
  error_fix: 'bg-amber-500/20 text-amber-400',
  pattern: 'bg-green-500/20 text-green-400',
  preference: 'bg-pink-500/20 text-pink-400',
  context: 'bg-gray-500/20 text-gray-400',
  code_pattern: 'bg-cyan-500/20 text-cyan-400',
  command: 'bg-orange-500/20 text-orange-400',
  conversation: 'bg-slate-500/20 text-slate-400',
  summary: 'bg-violet-500/20 text-violet-400',
};

export function ContextTab() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const handleAnalyze = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(api(`/api/cortex/context?q=${encodeURIComponent(query)}&limit=5`));
      if (res.ok) setResult(await res.json());
    } catch {}
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex gap-3 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            placeholder="Enter a query to analyze..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
          />
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50"
        >
          {loading ? 'Analyzing...' : 'Analyze'}
        </button>
      </div>

      {!result && !loading && (
        <p className="text-sm text-gray-600 text-center py-12">
          Enter a query to see how the Context Assembly Engine processes it
        </p>
      )}

      {result && (
        <>
          {/* Pipeline summary */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
              <div className="text-[10px] text-gray-600 uppercase mb-1">Intent</div>
              <div className={`text-lg font-semibold ${INTENT_COLORS[result.intent?.intent] || 'text-gray-400'}`}>
                {result.intent?.intent || '?'}
              </div>
              <div className="text-[10px] text-gray-600">confidence: {(result.intent?.confidence ?? 0).toFixed(2)}</div>
            </div>
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
              <div className="text-[10px] text-gray-600 uppercase mb-1">Entities</div>
              <div className="flex flex-wrap gap-1 mt-1">
                {(result.entities || []).map((e: any, i: number) => (
                  <span key={i} className="text-[10px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-gray-300">
                    {e.entity?.type}:{e.entity?.name}
                  </span>
                ))}
                {(!result.entities || result.entities.length === 0) && (
                  <span className="text-[10px] text-gray-600">none detected</span>
                )}
              </div>
            </div>
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
              <div className="text-[10px] text-gray-600 uppercase mb-1">Timing</div>
              <div className="text-lg font-semibold text-green-400">{result.timing?.totalMs ?? '?'}ms</div>
              <div className="text-[10px] text-gray-600">intent {result.timing?.intentMs}ms · search {result.timing?.searchMs}ms</div>
            </div>
          </div>

          {/* Source weights */}
          {result.sourceWeights && result.sourceWeights.length > 0 && (
            <div className="mb-6">
              <div className="text-[10px] text-gray-600 uppercase mb-2">Source Weights</div>
              <div className="flex gap-3">
                {result.sourceWeights.map((sw: any, i: number) => (
                  <div key={i} className="flex-1 bg-white/[0.02] rounded-lg p-3">
                    <div className="flex justify-between text-[11px] mb-1">
                      <span className="text-gray-300 capitalize">{sw.scopeLevel}</span>
                      <span className="text-gray-500">{sw.weight.toFixed(2)}</span>
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500/60 rounded-full" style={{ width: `${Math.min(100, sw.weight * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Results */}
          <div className="mb-6">
            <div className="text-[10px] text-gray-600 uppercase mb-2">Results ({(result.results || []).length})</div>
            <div className="space-y-1">
              {(result.results || []).map((r: any, i: number) => (
                <div key={i} className="flex items-center gap-2 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_COLORS[r.type] || TYPE_COLORS.context}`}>
                    {r.type?.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-gray-300 truncate flex-1">{r.text}</span>
                  <span className="text-[10px] text-gray-600 tabular-nums shrink-0">{(r.relevance_score ?? 0).toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Conflicts */}
          {Array.isArray(result.conflicts) && result.conflicts.length > 0 && (
            <div className="mb-6 border border-amber-500/20 bg-amber-500/5 rounded-lg p-3">
              <div className="text-[10px] text-amber-400 uppercase font-medium mb-1">Conflicts ({result.conflicts.length})</div>
              {result.conflicts.map((c: any, i: number) => (
                <div key={i} className="text-xs text-gray-400 mt-1">
                  &ldquo;{c.unitA?.text?.slice(0, 60)}...&rdquo; vs &ldquo;{c.unitB?.text?.slice(0, 60)}...&rdquo;
                </div>
              ))}
            </div>
          )}

          {/* Raw context */}
          <div>
            <button
              onClick={() => setShowRaw(!showRaw)}
              className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400 uppercase"
            >
              Raw context {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {showRaw && result.context && (
              <pre className="mt-2 p-3 bg-white/[0.02] border border-white/5 rounded-lg text-[11px] text-gray-400 overflow-x-auto whitespace-pre-wrap">
                {result.context}
              </pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}
