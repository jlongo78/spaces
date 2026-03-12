'use client';

import { useState, useEffect } from 'react';
import { Brain } from 'lucide-react';
import { useTier } from '@/hooks/use-tier';
import { api } from '@/lib/api';

export function CortexIndicator({ onClick }: { onClick?: () => void }) {
  const { hasCortex } = useTier();
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    if (!hasCortex) return;
    const fetchStatus = async () => {
      try {
        const res = await fetch(api('/api/cortex/status'));
        if (res.ok) setStatus(await res.json());
      } catch { /* ignore */ }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [hasCortex]);

  if (!hasCortex || !status?.enabled) return null;

  const totalUnits = Object.values(status.layers || {}).reduce(
    (sum: number, layer: any) => sum + (layer.count || 0), 0
  );

  const color = status.status === 'healthy' ? 'text-purple-400' : 'text-red-400';

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/5 transition-colors ${color}`}
      title={`Cortex: ${totalUnits} knowledge units`}
    >
      <Brain className="w-4 h-4" />
      <span className="text-xs tabular-nums">{totalUnits}</span>
      <span className="text-[9px] font-medium uppercase tracking-wider opacity-60">Beta</span>
    </button>
  );
}
