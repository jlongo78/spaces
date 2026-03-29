'use client';

import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function WizardChat({
  messages,
  onSend,
  loading,
}: {
  messages: Message[];
  onSend: (text: string) => void;
  loading: boolean;
}) {
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    onSend(text);
  };

  return (
    <>
      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !loading && (
          <div className="text-center py-12">
            <p className="text-zinc-400 text-sm mb-1">Describe the project you want to build.</p>
            <p className="text-zinc-600 text-xs">I'll help you plan the workspace, agents, and initial tasks.</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-zinc-200'
            }`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 rounded-lg px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-6 py-3 border-t border-zinc-800 flex-shrink-0">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Describe your project..."
            rows={2}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg flex items-center gap-1.5 text-sm self-end"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
  );
}
