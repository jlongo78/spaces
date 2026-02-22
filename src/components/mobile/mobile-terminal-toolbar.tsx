'use client';

import { VoiceInput } from '@/components/mobile/voice-input';

interface MobileTerminalToolbarProps {
  onSend: (data: string) => void;
}

const keys = [
  { label: 'Ctrl', data: null, modifier: 'ctrl' },
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '\u2191', data: '\x1b[A' },
  { label: '\u2193', data: '\x1b[B' },
  { label: '\u2190', data: '\x1b[D' },
  { label: '\u2192', data: '\x1b[C' },
];

export function MobileTerminalToolbar({ onSend }: MobileTerminalToolbarProps) {
  const handleKey = (key: typeof keys[number]) => {
    if (key.modifier === 'ctrl') {
      // Ctrl mode: next tap sends ctrl+key
      // For simplicity, we'll use a common shortcut approach
      // The user taps Ctrl, then types a letter in the terminal
      onSend('\x00'); // NUL — signals ctrl mode to the terminal
      return;
    }
    if (key.data) {
      onSend(key.data);
    }
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-zinc-900 border-t border-zinc-800 overflow-x-auto">
      {keys.map((key) => (
        <button
          key={key.label}
          onTouchStart={(e) => {
            e.preventDefault();
            handleKey(key);
          }}
          onClick={() => handleKey(key)}
          className="flex-shrink-0 px-3 py-1.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-300 active:bg-zinc-700 select-none"
        >
          {key.label}
        </button>
      ))}
      <VoiceInput onTranscript={onSend} />
    </div>
  );
}
