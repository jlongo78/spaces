'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { KnowledgeCard } from './knowledge-card';

interface CortexPanelProps {
  open: boolean;
  onClose: () => void;
}

type LayerTab = 'personal' | 'workspace' | 'team';

export function CortexPanel({ open, onClose }: CortexPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<LayerTab>('workspace');
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(api('/api/cortex/status'));
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
  }, []);

  const fetchResults = useCallback(async (searchQuery?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20', layer: activeTab });
      if (searchQuery) params.set('q', searchQuery);
      const res = await fetch(api(`/api/cortex/search?${params}`));
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeTab]);

  useEffect(() => {
    if (open) {
      fetchStats();
      fetchResults(query || undefined);
    }
  }, [open, activeTab, fetchStats, fetchResults]);

  const handleSearch = () => {
    fetchResults(query.trim() || undefined);
  };

  const handleDelete = (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
    fetchStats();
  };

  if (!open) return null;

  const tabs: LayerTab[] = ['personal', 'workspace', 'team'];

  return (
    <div className="fixed right-0 top-0 bottom-0 w-96 bg-gray-950 border-l border-white/10 z-[60] flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <h2 className="text-sm font-medium text-gray-200">
          Cortex
          <span className="ml-2 text-[9px] font-medium uppercase tracking-wider text-purple-400 bg-purple-400/10 px-1.5 py-0.5 rounded">Beta</span>
        </h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex gap-4 px-4 py-2 text-[10px] text-gray-500 border-b border-white/5">
          {Object.entries(stats.layers || {}).map(([layer, data]: [string, any]) => (
            <span key={layer}>{layer}: {data.count}</span>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="p-3 border-b border-white/5">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search knowledge..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-md text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
            />
          </div>
        </div>
      </div>

      {/* Layer tabs */}
      <div className="flex border-b border-white/5">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              activeTab === tab
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <p className="text-xs text-gray-500 text-center py-4">Searching...</p>}
        {!loading && results.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">
            {query ? 'No results' : 'No knowledge stored yet'}
          </p>
        )}
        {results.map(unit => (
          <KnowledgeCard key={unit.id} unit={unit} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}
