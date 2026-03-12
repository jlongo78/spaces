'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function CortexSettings() {
  const [config, setConfig] = useState<any>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(api('/api/cortex/settings')).then(r => r.json()).then(setConfig).catch(() => {});
  }, []);

  const save = async (updates: Record<string, any>) => {
    setSaving(true);
    await fetch(api('/api/cortex/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setConfig((prev: any) => ({ ...prev, ...updates }));
    setSaving(false);
  };

  const triggerBootstrap = async () => {
    await fetch(api('/api/cortex/ingest/bootstrap'), { method: 'POST' });
    const poll = setInterval(async () => {
      const res = await fetch(api('/api/cortex/ingest/status'));
      const data = await res.json();
      setBootstrapStatus(data);
      if (data.status === 'complete' || data.status === 'error') {
        clearInterval(poll);
      }
    }, 2000);
  };

  if (!config) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-gray-200">
        Cortex
        <span className="ml-2 text-[9px] font-medium uppercase tracking-wider text-purple-400 bg-purple-400/10 px-1.5 py-0.5 rounded">Beta</span>
      </h3>

      {/* Enable/disable */}
      <label className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Enable Cortex</span>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={e => save({ enabled: e.target.checked })}
          className="accent-purple-500"
        />
      </label>

      {/* Embedding provider */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Embedding provider</span>
        <span className="text-xs text-gray-300">{config.embedding?.provider || 'auto'}</span>
      </div>

      {/* Injection token budget */}
      <label className="block">
        <span className="text-xs text-gray-400">Injection token budget</span>
        <input
          type="range"
          min={500}
          max={5000}
          step={100}
          value={config.injection?.max_tokens || 2000}
          onChange={e => save({ injection: { max_tokens: parseInt(e.target.value) } })}
          className="w-full mt-1"
        />
        <span className="text-[10px] text-gray-500">{config.injection?.max_tokens || 2000} tokens</span>
      </label>

      {/* Distillation toggle */}
      <label className="flex items-center justify-between">
        <span className="text-xs text-gray-400">LLM distillation</span>
        <input
          type="checkbox"
          checked={config.ingestion?.distillation ?? true}
          onChange={e => save({ ingestion: { distillation: e.target.checked } })}
          className="accent-purple-500"
        />
      </label>

      {/* Federation sync mode */}
      <label className="block">
        <span className="text-xs text-gray-400">Federation sync mode</span>
        <select
          value={config.federation?.sync_mode || 'query-only'}
          onChange={e => save({ federation: { sync_mode: e.target.value } })}
          className="w-full mt-1 text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-300"
        >
          <option value="query-only">Query Only</option>
          <option value="background-sync">Background Sync</option>
          <option value="real-time-sync">Real-time Sync</option>
        </select>
      </label>

      {/* Bootstrap */}
      <div className="pt-2 border-t border-white/5">
        <button
          onClick={triggerBootstrap}
          disabled={bootstrapStatus?.status === 'running'}
          className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-50"
        >
          {bootstrapStatus?.status === 'running' ? 'Ingesting...' : 'Bootstrap Ingestion'}
        </button>
        {bootstrapStatus?.status === 'running' && (
          <div className="mt-2">
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all"
                style={{ width: `${(bootstrapStatus.processedFiles / Math.max(bootstrapStatus.totalFiles, 1)) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-500">
              {bootstrapStatus.processedFiles}/{bootstrapStatus.totalFiles} files
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
