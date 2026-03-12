'use client';

import { useState } from 'react';

interface InjectionBadgeProps {
  count: number;
  items?: Array<{ type: string; text: string }>;
}

export function InjectionBadge({ count, items }: InjectionBadgeProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (count === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-purple-400 hover:bg-purple-500/10 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
        {count} item{count !== 1 ? 's' : ''}
      </button>

      {showDetails && items && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-gray-900 border border-white/10 rounded-lg shadow-xl z-50 p-2 space-y-1">
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
