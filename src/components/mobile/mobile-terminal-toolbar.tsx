'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';

interface MobileTerminalToolbarProps {
  onSend: (data: string) => void;
}

const primaryKeys = [
  { label: 'Enter', data: '\r' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: 'y', data: 'y' },
  { label: 'n', data: 'n' },
];

const overflowKeys = [
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '/', data: '/' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: 'Ctrl+L', data: '\x0c' },
  { label: 'Ctrl+Z', data: '\x1a' },
];

export function MobileTerminalToolbar({ onSend }: MobileTerminalToolbarProps) {
  const [showOverflow, setShowOverflow] = useState(false);

  const renderKey = (key: { label: string; data: string }, highlight?: boolean) => (
    <button
      key={key.label}
      onTouchStart={(e) => { e.preventDefault(); onSend(key.data); }}
      onClick={() => onSend(key.data)}
      className={`flex-shrink-0 px-3 py-1.5 text-xs font-mono border rounded select-none active:bg-zinc-600 ${
        highlight
          ? 'bg-indigo-600 border-indigo-500 text-white'
          : 'bg-zinc-800 border-zinc-700 text-zinc-300'
      }`}
    >
      {key.label}
    </button>
  );

  return (
    <div className="flex flex-col border-t border-zinc-800 bg-zinc-900">
      {/* Primary keys */}
      <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto">
        {primaryKeys.map((key) => renderKey(key, key.label === 'Enter'))}

        <button
          onClick={() => setShowOverflow(!showOverflow)}
          className={`flex-shrink-0 px-2 py-1.5 text-xs font-mono border rounded select-none ${
            showOverflow
              ? 'bg-zinc-700 border-zinc-600 text-zinc-200'
              : 'bg-zinc-800 border-zinc-700 text-zinc-500'
          }`}
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showOverflow ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {/* Overflow keys */}
      {showOverflow && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-t border-zinc-800 overflow-x-auto">
          {overflowKeys.map((key) => renderKey(key))}
        </div>
      )}
    </div>
  );
}
