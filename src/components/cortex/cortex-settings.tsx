'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function CortexSettings() {
  const [config, setConfig] = useState<any>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(api('/api/cortex/settings')).then(r => r.json()).then(setConfig).catch(() => {});
    fetch(api('/api/cortex/usage')).then(r => r.json()).then(setUsage).catch(() => {});
  }, []);

  const save = async (updates: Record<string, any>) => {
    setSaving(true);
    try {
      const res = await fetch(api('/api/cortex/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        // For API keys, the server returns masked values — update display accordingly
        const masked: Record<string, any> = { ...updates };
        for (const k of ['anthropic_api_key', 'openai_api_key', 'voyage_api_key', 'groq_api_key']) {
          if (masked[k]) masked[k] = `…${masked[k].slice(-4)}`;
        }
        setConfig((prev: any) => ({ ...prev, ...masked }));
      }
    } catch { /* network error — UI stays unchanged */ }
    finally { setSaving(false); }
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

  const enabled = config?.enabled ?? false;
  const dim = !enabled ? 'opacity-40 pointer-events-none' : '';

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
          checked={enabled}
          disabled={!config}
          onChange={e => save({ enabled: e.target.checked })}
          className="accent-purple-500"
        />
      </label>

      {!config && <p className="text-[10px] text-gray-500">Loading…</p>}

      {/* API Keys */}
      <div className="space-y-3">
        <span className="text-xs text-gray-300 font-medium">API Keys</span>
        <p className="text-[10px] text-gray-600 -mt-2">Keys configured here override environment variables. Stored in ~/.spaces/config.json.</p>

        {[
          { key: 'anthropic_api_key', label: 'Anthropic', placeholder: 'sk-ant-…', hint: 'LLM distillation (Claude Haiku)' },
          { key: 'voyage_api_key', label: 'Voyage AI', placeholder: 'pa-…', hint: 'Embeddings — best for code/technical retrieval' },
          { key: 'openai_api_key', label: 'OpenAI', placeholder: 'sk-proj-…', hint: 'Embeddings fallback + transcription fallback' },
          { key: 'groq_api_key', label: 'Groq', placeholder: 'gsk_…', hint: 'Speech transcription (Quest voice input)' },
        ].map(({ key, label, placeholder, hint }) => (
          <div key={key} className="space-y-1">
            <span className="text-xs text-gray-400">{label}</span>
            {config?.[key] ? (
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500 font-mono">{config[key]}</span>
                <button onClick={() => save({ [key]: '' })} className="text-[10px] text-gray-600 hover:text-red-400">remove</button>
              </div>
            ) : (
              <div className="flex gap-1">
                <input
                  type="password"
                  value={keyInputs[key] || ''}
                  onChange={e => setKeyInputs(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="flex-1 text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-300 placeholder-gray-600"
                />
                <button
                  onClick={() => { if (keyInputs[key]) { save({ [key]: keyInputs[key] }); setKeyInputs(prev => ({ ...prev, [key]: '' })); } }}
                  disabled={!keyInputs[key]}
                  className="text-xs px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-30"
                >Save</button>
              </div>
            )}
            <p className="text-[10px] text-gray-600">{hint}</p>
          </div>
        ))}
      </div>

      {/* Debug logging */}
      <label className="flex items-center justify-between">
        <div>
          <span className="text-xs text-gray-400">Debug logging</span>
          <p className="text-[10px] text-gray-600">Verbose memory, LanceDB, embedding, and distillation logs in server console</p>
        </div>
        <input
          type="checkbox"
          checked={config?.debug ?? false}
          onChange={e => save({ debug: e.target.checked })}
          className="accent-purple-500 shrink-0 ml-3"
        />
      </label>

      {/* Embedding provider */}
      <div className={`block ${dim}`}>
        <span className="text-xs text-gray-400">Embedding provider</span>
        <p className="text-[10px] text-gray-600 mb-1">Changing provider requires re-indexing all knowledge (existing embeddings will be cleared)</p>
        <select
          value={config?.embedding?.provider || 'auto'}
          onChange={e => {
            const provider = e.target.value;
            if (provider !== (config?.embedding?.provider || 'auto')) {
              if (confirm('Changing embedding provider will clear all existing embeddings. Knowledge will be re-embedded on next ingestion. Continue?')) {
                save({ embedding: { provider } });
              }
            }
          }}
          className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-300"
        >
          <option value="auto">Auto-detect (Voyage → OpenAI → Local)</option>
          <option value="voyage">Voyage AI — best for code (512-dim, requires key)</option>
          <option value="openai">OpenAI — general purpose (1536-dim, requires key)</option>
          <option value="local">Local — free, no API needed (384-dim, lower quality)</option>
        </select>
      </div>

      {/* Injection token budget */}
      <div className={`block ${dim}`}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-400">Context injection budget</span>
          <span className="text-[10px] text-gray-500">{config?.injection?.max_tokens || 2000} tokens</span>
        </div>
        <input
          type="range"
          min={500}
          max={20000}
          step={500}
          value={config?.injection?.max_tokens || 2000}
          onChange={e => save({ injection: { max_tokens: parseInt(e.target.value) } })}
          className="w-full"
        />
        <p className="text-[10px] text-gray-600 mt-0.5">Tokens of retrieved knowledge injected per prompt (Claude context: 200K)</p>
      </div>

      {/* Distillation toggle */}
      <label className={`flex items-center justify-between ${dim}`}>
        <div>
          <span className="text-xs text-gray-400">LLM distillation</span>
          <p className="text-[10px] text-gray-600">4 Haiku API calls per session end — cleaner knowledge at ~$0.03–0.05/session</p>
        </div>
        <input
          type="checkbox"
          checked={config?.ingestion?.distillation ?? true}
          onChange={e => save({ ingestion: { distillation: e.target.checked } })}
          className="accent-purple-500 shrink-0 ml-3"
        />
      </label>

      {/* Federation sync mode */}
      <div className={`block ${dim}`}>
        <span className="text-xs text-gray-400">Federation sync mode</span>
        <p className="text-[10px] text-gray-600 mb-1">How knowledge is shared across multiple Spaces instances</p>
        <select
          value={config?.federation?.sync_mode || 'query-only'}
          onChange={e => save({ federation: { sync_mode: e.target.value } })}
          className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-300"
        >
          <option value="query-only">Query Only — read from remotes, no push</option>
          <option value="background-sync">Background Sync — periodic two-way sync</option>
          <option value="real-time-sync">Real-time Sync — sync on every store</option>
        </select>
      </div>

      {/* Distillation usage */}
      {usage && (usage.distillation?.calls > 0) && (
        <div className="pt-2 border-t border-white/5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">Distillation usage</span>
            <button
              onClick={() => fetch(api('/api/cortex/usage'), { method: 'DELETE' }).then(() => setUsage(null))}
              className="text-[10px] text-gray-600 hover:text-gray-400"
            >reset</button>
          </div>
          <div className="text-[10px] text-gray-500 space-y-0.5">
            <div className="flex justify-between">
              <span>API calls</span>
              <span className="text-gray-400">{usage.distillation.calls.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>Tokens in / out</span>
              <span className="text-gray-400">
                {(usage.distillation.input_tokens / 1000).toFixed(1)}K / {(usage.distillation.output_tokens / 1000).toFixed(1)}K
              </span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Estimated cost</span>
              <span className="text-purple-400">${usage.distillation.estimated_cost_usd.toFixed(4)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Bootstrap */}
      <div className={`pt-2 border-t border-white/5 ${dim}`}>
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
