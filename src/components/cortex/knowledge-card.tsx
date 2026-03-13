'use client';

import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';

const TYPE_COLORS: Record<string, string> = {
  decision: 'bg-blue-500/20 text-blue-400',
  preference: 'bg-pink-500/20 text-pink-400',
  pattern: 'bg-green-500/20 text-green-400',
  error_fix: 'bg-amber-500/20 text-amber-400',
  context: 'bg-gray-500/20 text-gray-400',
  code_pattern: 'bg-cyan-500/20 text-cyan-400',
  command: 'bg-orange-500/20 text-orange-400',
  conversation: 'bg-slate-500/20 text-slate-400',
  summary: 'bg-violet-500/20 text-violet-400',
};

interface KnowledgeCardProps {
  unit: {
    id: string;
    text: string;
    type: string;
    confidence: number;
    created: string;
    session_id?: string | null;
    layer: string;
    stale_score?: number;
  };
  onDelete?: (id: string) => void;
}

export function KnowledgeCard({ unit, onDelete }: KnowledgeCardProps) {
  const colorClass = TYPE_COLORS[unit.type] || TYPE_COLORS.context;
  const age = getRelativeAge(unit.created);
  const confidencePct = Math.round(unit.confidence * 100);

  const handleDelete = async () => {
    await fetch(api(`/api/cortex/knowledge/${unit.id}`), { method: 'DELETE' });
    onDelete?.(unit.id);
  };

  return (
    <div className="group border border-white/5 rounded-lg p-3 hover:border-white/10 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colorClass}`}>
            {unit.type.replace('_', ' ')}
          </span>
          {(unit.stale_score ?? 0) > 0.3 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/20 text-amber-400"
              title="Referenced files have changed since this was learned"
            >
              stale
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span>{age}</span>
          <button
            onClick={handleDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-300 mt-1.5 leading-relaxed">{unit.text}</p>
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500/50 rounded-full"
            style={{ width: `${confidencePct}%` }}
          />
        </div>
        <span className="text-[10px] text-gray-500 tabular-nums">{confidencePct}%</span>
      </div>
    </div>
  );
}

function getRelativeAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
