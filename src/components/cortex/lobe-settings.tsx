'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Tag, Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { LobeConfig } from '@/lib/cortex/lobes/config';

interface LobeInfo {
  workspaceId: number;
  name: string;
  color: string;
  config: LobeConfig;
}

interface Props {
  workspaceId: number;
  workspaceName: string;
}

export function LobeSettings({ workspaceId, workspaceName }: Props) {
  const [config, setConfig] = useState<LobeConfig | null>(null);
  const [allLobes, setAllLobes] = useState<LobeInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch this workspace's lobe config and all lobes (for exclusion UI)
    Promise.all([
      fetch(api(`/api/cortex/lobes/${workspaceId}`)).then(r => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      }),
      fetch(api('/api/cortex/lobes')).then(r => r.json()).catch(() => ({ lobes: [] })),
    ])
      .then(([lobeData, allData]) => {
        setConfig(lobeData.config ?? null);
        setAllLobes((allData.lobes || []).filter((l: LobeInfo) => l.workspaceId !== workspaceId));
      })
      .catch(err => setError(err.message || 'Failed to load'));
  }, [workspaceId]);

  const save = async (partial: Partial<LobeConfig>) => {
    if (!config) return;
    const updated = { ...config, ...partial };
    setConfig(updated);
    setSaving(true);
    try {
      const res = await fetch(api(`/api/cortex/lobes/${workspaceId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      const data = await res.json();
      if (data.config) setConfig(data.config);
    } catch { /* optimistic update already applied */ }
    finally { setSaving(false); }
  };

  const addTag = () => {
    if (!config || !newTag.trim()) return;
    const tag = newTag.trim();
    if (config.tags.includes(tag)) { setNewTag(''); return; }
    save({ tags: [...config.tags, tag] });
    setNewTag('');
  };

  const removeTag = (tag: string) => {
    if (!config) return;
    save({ tags: config.tags.filter(t => t !== tag) });
  };

  const toggleExclusion = (wsId: number) => {
    if (!config) return;
    const excluded = config.excludedFrom.includes(wsId)
      ? config.excludedFrom.filter(id => id !== wsId)
      : [...config.excludedFrom, wsId];
    save({ excludedFrom: excluded });
  };

  if (error) return (
    <div className="text-[11px] text-red-400/80">{error}</div>
  );
  if (!config) return (
    <div className="text-[11px] text-zinc-600">Loading...</div>
  );

  return (
    <div className="space-y-3">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
        Knowledge Lobe
      </div>

      {/* Privacy toggle */}
      <button
        onClick={() => save({ isPrivate: !config.isPrivate })}
        disabled={saving}
        className="flex items-center gap-2 w-full text-left group disabled:opacity-50"
      >
        <span className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${
          config.isPrivate
            ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
            : 'bg-zinc-800 border-zinc-700 text-zinc-500 group-hover:border-zinc-500'
        }`}>
          {config.isPrivate
            ? <EyeOff className="w-2.5 h-2.5" />
            : <Eye className="w-2.5 h-2.5" />}
        </span>
        <span className="text-xs text-zinc-400 group-hover:text-zinc-300 transition-colors">
          {config.isPrivate ? 'Private — hidden from other workspaces' : 'Visible to other workspaces'}
        </span>
      </button>

      {/* Tags — categorize this workspace's knowledge */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1 text-[10px] text-zinc-500">
          <Tag className="w-3 h-3" />
          <span>Topics</span>
          <span className="text-zinc-700 ml-1">— Cortex uses these to scope knowledge retrieval</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {config.tags.map(tag => (
            <span
              key={tag}
              className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded text-[11px] text-purple-300"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="hover:text-red-400 transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <span className="flex items-center gap-0.5">
            <input
              type="text"
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTag(); }}
              placeholder="add topic..."
              className="w-20 px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50"
            />
            {newTag.trim() && (
              <button
                onClick={addTag}
                className="text-purple-400 hover:text-purple-300 transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
          </span>
        </div>
      </div>

      {/* Domain context */}
      <div className="space-y-1.5">
        <div className="text-[10px] text-zinc-500">
          Domain Context
          <span className="text-zinc-700 ml-1">— injected into distillation prompts for better extraction</span>
        </div>
        <textarea
          value={config.domain_context || ''}
          onChange={e => save({ domain_context: e.target.value })}
          placeholder="Describe the domain expertise this lobe should focus on. E.g. 'This workspace covers CFB power plant engineering.'"
          rows={3}
          disabled={saving}
          className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 resize-y disabled:opacity-50"
        />
      </div>

      {/* Sibling workspace access — toggle which workspaces can see this lobe */}
      {allLobes.length > 0 && !config.isPrivate && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-zinc-500">
            Sibling access — uncheck to block a workspace from this lobe
          </div>
          <div className="space-y-0.5">
            {allLobes.map(lobe => {
              const excluded = config.excludedFrom.includes(lobe.workspaceId);
              return (
                <button
                  key={lobe.workspaceId}
                  onClick={() => toggleExclusion(lobe.workspaceId)}
                  disabled={saving}
                  className="flex items-center gap-2 w-full px-2 py-1 rounded text-left hover:bg-zinc-800/50 transition-colors disabled:opacity-50"
                >
                  <span className={`w-3 h-3 rounded-sm border flex items-center justify-center transition-colors ${
                    excluded
                      ? 'border-zinc-700 bg-zinc-800'
                      : 'border-purple-500/50 bg-purple-500/20'
                  }`}>
                    {!excluded && (
                      <svg className="w-2 h-2 text-purple-400" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </span>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: lobe.color }}
                  />
                  <span className={`text-xs ${excluded ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                    {lobe.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
