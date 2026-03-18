'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { KnowledgeTab } from '@/components/cortex/knowledge-tab';
import { ContextTab } from '@/components/cortex/context-tab';
import { CortexSettings } from '@/components/cortex/cortex-settings';

const EntityGraphView = dynamic(
  () => import('@/components/cortex/entity-graph').then(m => ({ default: m.EntityGraphView })),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading graph...</div> }
);

type Tab = 'graph' | 'knowledge' | 'context' | 'settings';

export default function CortexPage() {
  const [tab, setTab] = useState<Tab>('graph');
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    fetch(api('/api/cortex/status'))
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'graph', label: 'Graph' },
    { key: 'knowledge', label: 'Knowledge' },
    { key: 'context', label: 'Context' },
    { key: 'settings', label: 'Settings' },
  ];

  const totalKnowledge = stats
    ? Object.values(stats.layers || {}).reduce((sum: number, l: any) => sum + (l.count || 0), 0)
    : 0;

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      <div className="flex items-center border-b border-white/5 px-4 shrink-0">
        <div className="flex">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? 'text-purple-400 border-purple-400'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs text-gray-600">
          {totalKnowledge} knowledge units
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'graph' && <EntityGraphView />}
        {tab === 'knowledge' && <KnowledgeTab />}
        {tab === 'context' && <ContextTab />}
        {tab === 'settings' && (
          <div className="p-6 max-w-2xl space-y-8">
            <CortexSettings />
          </div>
        )}
      </div>
    </div>
  );
}
