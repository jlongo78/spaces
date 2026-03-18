'use client';

import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';

interface InjectionBadgeProps {
  count: number;
  items?: Array<{ type: string; text: string }>;
}

export function InjectionBadge({ count, items }: InjectionBadgeProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [liveCount, setLiveCount] = useState(count);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update from prop when it changes (initial injection)
  useEffect(() => {
    if (count > 0) setLiveCount(count);
  }, [count]);

  // Poll cortex status for live knowledge count
  useEffect(() => {
    const poll = () => {
      fetch(api('/api/cortex/status'))
        .then(r => r.json())
        .then(data => {
          if (data.layers) {
            const total = Object.values(data.layers).reduce(
              (sum: number, l: any) => sum + (l.count || 0), 0
            );
            if (total > 0) setLiveCount(total as number);
          }
        })
        .catch(() => {});
    };

    // Poll quickly at first (model may still be loading), then slow down
    const initTimer = setTimeout(poll, 2000);
    const earlyTimer = setTimeout(poll, 8000);
    timerRef.current = setInterval(poll, 30000);

    return () => {
      clearTimeout(initTimer);
      clearTimeout(earlyTimer);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-purple-400 hover:bg-purple-500/10 transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${liveCount > 0 ? 'bg-purple-400' : 'bg-zinc-600'}`} />
        {liveCount > 0 ? `${liveCount} item${liveCount !== 1 ? 's' : ''}` : 'Cortex'}
      </button>

      {showDetails && items && items.length > 0 && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-gray-900 border border-white/10 rounded-lg shadow-xl z-50 p-2 space-y-1">
          <div className="text-[9px] text-gray-600 mb-1">Last injected context:</div>
          {items.map((item, i) => (
            <div key={i} className="text-[10px] text-gray-400">
              <span className="text-purple-400">[{item.type}]</span> {item.text.slice(0, 100)}
              {item.text.length > 100 && '...'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
