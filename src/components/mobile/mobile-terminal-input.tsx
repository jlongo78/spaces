'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send } from 'lucide-react';
import { VoiceInput } from './voice-input';
import { cn } from '@/lib/utils';

interface MobileTerminalInputProps {
  onSend: (data: string) => void;
}

export function MobileTerminalInput({ onSend }: MobileTerminalInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea (1 line to max 4 lines)
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 96)}px`;
    }
  }, [text]);

  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    onSend(text + '\r');
    setText('');
    // Refocus for next input
    textareaRef.current?.focus();
  }, [text, onSend]);

  const handleVoiceTranscript = useCallback((transcript: string) => {
    setText(prev => prev ? `${prev} ${transcript}` : transcript);
    textareaRef.current?.focus();
  }, []);

  return (
    <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-end gap-2 px-3 py-2">
        <VoiceInput onTranscript={handleVoiceTranscript} />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a command..."
          rows={1}
          className={cn(
            'flex-1 resize-none rounded-xl border px-3 py-2 text-sm bg-zinc-900',
            'focus:outline-none focus:ring-1 focus:ring-indigo-500',
            'placeholder:text-zinc-600 border-zinc-700',
            'max-h-[96px]',
          )}
        />

        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className={cn(
            'p-2.5 rounded-xl flex-shrink-0',
            text.trim()
              ? 'bg-indigo-500 text-white'
              : 'bg-zinc-800 text-zinc-600'
          )}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
