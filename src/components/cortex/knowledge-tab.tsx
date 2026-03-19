'use client';

import { useState, useCallback, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { KnowledgeCard } from './knowledge-card';
import { INTENT_COLORS, TYPE_COLORS } from './constants';

export function KnowledgeTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [analyzerQuery, setAnalyzerQuery] = useState('');
  const [analyzerResult, setAnalyzerResult] = useState<any>(null);
  const [analyzerLoading, setAnalyzerLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!analyzerQuery.trim()) return;
    setAnalyzerLoading(true);
    try {
      const res = await fetch(api(`/api/cortex/context?q=${encodeURIComponent(analyzerQuery)}&limit=5`));
      if (res.ok) setAnalyzerResult(await res.json());
    } catch {}
    setAnalyzerLoading(false);
  };

  const fetchResults = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '30' });
      if (q) params.set('q', q);
      const res = await fetch(api(`/api/cortex/search?${params}`));
      if (res.ok) setResults((await res.json()).results || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  const handleSearch = () => fetchResults(query.trim() || undefined);
  const handleDelete = (id: string) => setResults(prev => prev.filter(r => r.id !== id));

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-white/5">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search knowledge..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl space-y-2">
          {loading && <p className="text-sm text-gray-500 text-center py-8">Loading...</p>}
          {!loading && results.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">No knowledge found</p>
          )}
          {results.map(unit => (
            <KnowledgeCard key={unit.id} unit={unit} onDelete={handleDelete} />
          ))}

          {/* Query Analyzer */}
          <div className="border-t border-white/5 mt-4 pt-4">
            <button
              onClick={() => setAnalyzerOpen(!analyzerOpen)}
              className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 mb-3"
            >
              {analyzerOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Query Analyzer
            </button>
            {analyzerOpen && (
              <div>
                <div className="flex gap-3 mb-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
                    <input
                      value={analyzerQuery}
                      onChange={e => setAnalyzerQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                      placeholder="Enter a query to analyze..."
                      className="w-full pl-9 pr-4 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
                    />
                  </div>
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzerLoading}
                    className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50"
                  >
                    {analyzerLoading ? 'Analyzing...' : 'Analyze'}
                  </button>
                </div>

                {!analyzerResult && !analyzerLoading && (
                  <p className="text-sm text-gray-600 text-center py-8">
                    Enter a query to see how the Context Engine processes it
                  </p>
                )}

                {analyzerResult && (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
                        <div className="text-[10px] text-gray-600 uppercase mb-1">Intent</div>
                        <div className={`text-lg font-semibold ${INTENT_COLORS[analyzerResult.intent?.intent] || 'text-gray-400'}`}>
                          {analyzerResult.intent?.intent || '?'}
                        </div>
                        <div className="text-[10px] text-gray-600">confidence: {(analyzerResult.intent?.confidence ?? 0).toFixed(2)}</div>
                      </div>
                      <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
                        <div className="text-[10px] text-gray-600 uppercase mb-1">Entities</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(analyzerResult.entities || []).map((e: any, i: number) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-gray-300">
                              {e.entity?.type}:{e.entity?.name}
                            </span>
                          ))}
                          {(!analyzerResult.entities || analyzerResult.entities.length === 0) && (
                            <span className="text-[10px] text-gray-600">none detected</span>
                          )}
                        </div>
                      </div>
                      <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
                        <div className="text-[10px] text-gray-600 uppercase mb-1">Timing</div>
                        <div className="text-lg font-semibold text-green-400">{analyzerResult.timing?.totalMs ?? '?'}ms</div>
                        <div className="text-[10px] text-gray-600">intent {analyzerResult.timing?.intentMs}ms · search {analyzerResult.timing?.searchMs}ms</div>
                      </div>
                    </div>

                    <div className="mb-4">
                      <div className="text-[10px] text-gray-600 uppercase mb-2">Results ({(analyzerResult.results || []).length})</div>
                      <div className="space-y-1">
                        {(analyzerResult.results || []).map((r: any, i: number) => (
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
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
