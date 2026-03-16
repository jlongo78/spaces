'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const RELATION_COLORS: Record<string, string> = {
  member_of: 'text-purple-400',
  expert_in: 'text-cyan-400',
  owns: 'text-green-400',
  contains: 'text-green-400',
  part_of: 'text-blue-400',
  works_on: 'text-purple-400',
  touches: 'text-amber-400',
  depends_on: 'text-red-400',
  relates_to: 'text-cyan-400',
};

interface EntityDetailProps {
  node: { id: string; name: string; type: string; metadata: Record<string, unknown> } | null;
  onClose: () => void;
}

export function EntityDetail({ node, onClose }: EntityDetailProps) {
  const [edges, setEdges] = useState<any[]>([]);

  useEffect(() => {
    if (!node) { setEdges([]); return; }
    Promise.all([
      fetch(api(`/api/cortex/graph/edges?from=${node.id}`)).then(r => r.json()),
      fetch(api(`/api/cortex/graph/edges?to=${node.id}`)).then(r => r.json()),
    ]).then(([fromData, toData]) => {
      setEdges([
        ...(fromData.edges || []).map((e: any) => ({ ...e, direction: 'out' })),
        ...(toData.edges || []).map((e: any) => ({ ...e, direction: 'in' })),
      ]);
    }).catch(() => {});
  }, [node?.id]);

  if (!node) {
    return (
      <div className="p-4 text-center text-gray-600 text-xs mt-8">
        Click a node to see details
      </div>
    );
  }

  const firstLetter = node.name.charAt(0).toUpperCase();
  const color = node.type === 'person' ? '#7c3aed'
    : node.type === 'system' ? '#f59e0b'
    : node.type === 'topic' ? '#06b6d4' : '#10b981';

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ backgroundColor: color + '33', color, border: `2px solid ${color}` }}>
          {firstLetter}
        </div>
        <div>
          <div className="text-sm font-medium text-gray-200">{node.name}</div>
          <div className="text-[10px] text-gray-500">{node.type}</div>
        </div>
      </div>
      {Object.keys(node.metadata).length > 0 && (
        <div className="mb-4">
          <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Metadata</div>
          {Object.entries(node.metadata).map(([k, v]) => (
            <div key={k} className="text-[11px] text-gray-400">
              <span className="text-gray-600">{k}:</span> {String(v)}
            </div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">
        Relationships ({edges.length})
      </div>
      <div className="space-y-1">
        {edges.map((e, i) => {
          const relColor = RELATION_COLORS[e.relation] || 'text-gray-400';
          const target = e.direction === 'out' ? e.target_id : e.source_id;
          const arrow = e.direction === 'out' ? '→' : '←';
          return (
            <div key={i} className="flex items-center gap-1.5 text-[11px] bg-white/[0.02] rounded px-2 py-1.5">
              <span className={relColor}>{e.relation}</span>
              <span className="text-gray-600">{arrow}</span>
              <span className="text-gray-300 truncate">
                {target.replace(/^(person|team|system|topic|project|department|organization|module)-/, '')}
              </span>
              {e.weight < 1 && (
                <span className="text-gray-600 ml-auto text-[9px]">{e.weight.toFixed(2)}</span>
              )}
            </div>
          );
        })}
        {edges.length === 0 && (
          <div className="text-[11px] text-gray-600 py-2">No relationships</div>
        )}
      </div>
    </div>
  );
}
