'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

type TargetLayer = 'personal' | 'workspace' | 'team';
type MergeStrategy = 'append' | 'merge' | 'replace';

interface ImportDialogProps {
  filename: string;
  hasDomainContext: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function ImportDialog({ filename, hasDomainContext, onClose, onComplete }: ImportDialogProps) {
  const [targetLayer, setTargetLayer] = useState<TargetLayer>('personal');
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>('append');
  const [reEmbed, setReEmbed] = useState(false);
  const [applyDomainContext, setApplyDomainContext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (targetLayer === 'workspace') {
      fetch(api('/api/workspaces'))
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const list: { id: string; name: string }[] = data?.workspaces ?? data ?? [];
          setWorkspaces(list);
          if (list.length > 0 && !workspaceId) setWorkspaceId(list[0].id);
        })
        .catch(() => {});
    }
  }, [targetLayer]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImport = async () => {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        marketplace_file: filename,
        target_layer: targetLayer,
        merge_strategy: mergeStrategy,
        re_embed: reEmbed,
      };
      if (targetLayer === 'workspace' && workspaceId) {
        body.workspace_id = workspaceId;
      }
      if (hasDomainContext) {
        body.apply_domain_context = applyDomainContext;
      }
      const res = await fetch(api('/api/cortex/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      onComplete();
    } catch (err: any) {
      setError(err?.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const layerOptions: { value: TargetLayer; label: string }[] = [
    { value: 'personal', label: 'Personal' },
    { value: 'workspace', label: 'Workspace' },
    { value: 'team', label: 'Team' },
  ];

  const strategyOptions: { value: MergeStrategy; label: string }[] = [
    { value: 'append', label: 'Append' },
    { value: 'merge', label: 'Merge' },
    { value: 'replace', label: 'Replace' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-white/10 rounded-xl p-6 max-w-md w-full flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">Import Pack</h2>
            <p className="text-[11px] text-gray-500 mt-0.5 font-mono break-all">{filename}</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Target layer */}
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">Target layer</p>
          <div className="flex gap-2">
            {layerOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTargetLayer(opt.value)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  targetLayer === opt.value
                    ? 'bg-purple-600 border-purple-500 text-white'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Workspace selector */}
        {targetLayer === 'workspace' && (
          <div>
            <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">Workspace</p>
            {workspaces.length === 0 ? (
              <p className="text-xs text-gray-600">No workspaces found</p>
            ) : (
              <select
                value={workspaceId}
                onChange={e => setWorkspaceId(e.target.value)}
                className="w-full py-2 px-3 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-300 focus:outline-none focus:border-purple-500/50"
              >
                {workspaces.map(ws => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Merge strategy */}
        <div>
          <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">Merge strategy</p>
          <div className="flex gap-2">
            {strategyOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setMergeStrategy(opt.value)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                  mergeStrategy === opt.value
                    ? 'bg-purple-600 border-purple-500 text-white'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Checkboxes */}
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2.5 cursor-pointer select-none group">
            <input
              type="checkbox"
              checked={reEmbed}
              onChange={e => setReEmbed(e.target.checked)}
              className="w-3.5 h-3.5 accent-purple-500"
            />
            <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors">
              Re-embed on import
            </span>
          </label>
          {hasDomainContext && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={applyDomainContext}
                onChange={e => setApplyDomainContext(e.target.checked)}
                className="w-3.5 h-3.5 accent-purple-500"
              />
              <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors">
                Apply domain context
              </span>
            </label>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Import button */}
        <button
          onClick={handleImport}
          disabled={loading}
          className="w-full py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {loading ? 'Importing...' : 'Import'}
        </button>
      </div>
    </div>
  );
}
