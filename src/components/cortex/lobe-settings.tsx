'use client';

import { useState, useEffect } from 'react';
import { Shield, ShieldOff, Tag, Plus, X, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { LobeConfig, LobeSubscription } from '@/lib/cortex/lobes/config';

interface Props {
  workspaceId: number;
  workspaceName: string;
}

export function LobeSettings({ workspaceId, workspaceName }: Props) {
  const [config, setConfig] = useState<LobeConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    fetch(api(`/api/cortex/lobes/${workspaceId}`))
      .then(r => r.json())
      .then(data => setConfig(data.config ?? null))
      .catch(() => {});
  }, [workspaceId]);

  const save = async (partial: Partial<LobeConfig>) => {
    if (!config) return;
    const updated = { ...config, ...partial };
    setSaving(true);
    try {
      const res = await fetch(api(`/api/cortex/lobes/${workspaceId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
      const data = await res.json();
      if (data.config) setConfig(data.config);
      else setConfig(updated);
    } catch {
      setConfig(updated);
    } finally {
      setSaving(false);
    }
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

  const removeSubscription = (sub: LobeSubscription) => {
    if (!config) return;
    save({ subscriptions: config.subscriptions.filter(s => s.id !== sub.id || s.type !== sub.type) });
  };

  const removeExclusion = (id: number) => {
    if (!config) return;
    save({ excludedFrom: config.excludedFrom.filter(e => e !== id) });
  };

  if (!config) return null;

  const activeSourceCount =
    1 + // own workspace
    (config.isPrivate ? 0 : 1) + // personal
    config.subscriptions.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-200">
          Knowledge Lobe
          <span className="ml-2 text-xs text-gray-500 font-normal">{workspaceName}</span>
        </h3>
        <span className="text-[10px] text-gray-500">{activeSourceCount} active sources</span>
      </div>

      {/* Privacy toggle */}
      <label className="flex items-center justify-between cursor-pointer group">
        <div className="flex items-center gap-2 text-xs text-gray-400 group-hover:text-gray-300 transition-colors">
          {config.isPrivate
            ? <ShieldOff className="w-3.5 h-3.5 text-amber-400" />
            : <Shield className="w-3.5 h-3.5 text-green-400" />}
          <span>{config.isPrivate ? 'Private (not visible to siblings)' : 'Visible to sibling workspaces'}</span>
        </div>
        <button
          onClick={() => save({ isPrivate: !config.isPrivate })}
          disabled={saving}
          className={`relative w-8 h-4.5 rounded-full transition-colors disabled:opacity-50 ${
            config.isPrivate ? 'bg-amber-500/40' : 'bg-green-500/40'
          }`}
          style={{ height: '18px' }}
          aria-label="Toggle privacy"
        >
          <span
            className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-transform ${
              config.isPrivate
                ? 'translate-x-0.5 bg-amber-400'
                : 'translate-x-4 bg-green-400'
            }`}
          />
        </button>
      </label>

      {/* Tags */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Tag className="w-3.5 h-3.5" />
          <span>Tags</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {config.tags.map(tag => (
            <span
              key={tag}
              className="flex items-center gap-1 px-2 py-0.5 bg-white/5 border border-white/10 rounded-full text-[11px] text-gray-300"
            >
              {tag}
              <button
                onClick={() => removeTag(tag)}
                className="hover:text-red-400 transition-colors"
                aria-label={`Remove tag ${tag}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <input
              type="text"
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTag(); }}
              placeholder="Add tag…"
              className="w-24 px-2 py-0.5 bg-white/5 border border-white/10 rounded-full text-[11px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
            />
            <button
              onClick={addTag}
              disabled={!newTag.trim()}
              className="text-gray-500 hover:text-gray-300 disabled:opacity-30 transition-colors"
              aria-label="Add tag"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </span>
        </div>
      </div>

      {/* Subscriptions */}
      {config.subscriptions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Users className="w-3.5 h-3.5" />
            <span>Subscriptions</span>
          </div>
          <div className="space-y-1">
            {config.subscriptions.map(sub => (
              <div
                key={`${sub.type}:${sub.id}`}
                className="flex items-center justify-between px-2.5 py-1.5 bg-white/5 border border-white/5 rounded text-xs"
              >
                <span className="text-gray-300">{sub.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-600 capitalize">{sub.type}</span>
                  <button
                    onClick={() => removeSubscription(sub)}
                    className="text-gray-600 hover:text-red-400 transition-colors"
                    aria-label={`Remove subscription ${sub.label}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Exclusions */}
      {config.excludedFrom.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <ShieldOff className="w-3.5 h-3.5" />
            <span>Excluded from workspaces</span>
          </div>
          <div className="space-y-1">
            {config.excludedFrom.map(wsId => (
              <div
                key={wsId}
                className="flex items-center justify-between px-2.5 py-1.5 bg-white/5 border border-white/5 rounded text-xs"
              >
                <span className="text-gray-300">Workspace {wsId}</span>
                <button
                  onClick={() => removeExclusion(wsId)}
                  className="text-gray-600 hover:text-red-400 transition-colors"
                  aria-label={`Remove exclusion for workspace ${wsId}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {saving && (
        <p className="text-[10px] text-gray-600">Saving…</p>
      )}
    </div>
  );
}
