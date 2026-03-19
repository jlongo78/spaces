'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';

export function UpdateBanner() {
  const [info, setInfo] = useState<{ available: boolean; current?: string; latest?: string; name?: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check on mount and every 4 hours
    const check = () => {
      fetch(api('/api/updates'))
        .then(r => r.json())
        .then(d => { if (d.available) setInfo(d); })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 4 * 3600_000);
    return () => clearInterval(interval);
  }, []);

  if (!info?.available || dismissed) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-indigo-500/10 border-b border-indigo-500/20 text-xs shrink-0">
      <span className="text-indigo-300">
        Update available: <span className="font-mono">{info.current}</span> → <span className="font-mono font-medium text-indigo-200">{info.latest}</span>
      </span>
      <div className="flex items-center gap-3">
        <code className="text-[10px] text-indigo-400/70 bg-indigo-500/10 px-2 py-0.5 rounded">
          npm i -g {info.name}
        </code>
        <button onClick={() => setDismissed(true)} className="text-indigo-500/50 hover:text-indigo-300">
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
