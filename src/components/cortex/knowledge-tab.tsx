'use client';

import { useState, useCallback, useEffect } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { KnowledgeCard } from './knowledge-card';

export function KnowledgeTab() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

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
        </div>
      </div>
    </div>
  );
}
