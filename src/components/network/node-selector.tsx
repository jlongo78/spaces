'use client';

import { useNodes } from '@/hooks/use-network';
import { Globe } from 'lucide-react';
import { HAS_NETWORK } from '@/lib/tier';

interface NodeSelectorProps {
  value: string;
  onChange: (nodeId: string) => void;
}

const statusDot: Record<string, string> = {
  online: '#22c55e',
  offline: '#ef4444',
  error: '#f59e0b',
  unknown: '#71717a',
};

export function NodeSelector({ value, onChange }: NodeSelectorProps) {
  const { data: nodes } = useNodes(HAS_NETWORK);

  if (!Array.isArray(nodes) || nodes.length === 0) return null;

  return (
    <div>
      <label className="text-[11px] text-zinc-400 mb-1.5 block">Node</label>
      <div className="relative">
        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-md focus:outline-none focus:border-indigo-500 text-white appearance-none"
        >
          <option value="">Local (this machine)</option>
          {nodes.map((node) => (
            <option
              key={node.id}
              value={node.id}
              disabled={node.status === 'offline'}
            >
              {node.status === 'offline' ? `${node.name} (offline)` : node.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
