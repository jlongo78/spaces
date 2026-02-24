'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Square, Loader2 } from 'lucide-react';
import { VoiceInput } from './voice-input';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MobileChatInputProps {
  sessionId: string;
  projectPath?: string;
  onMessageSent?: () => void;
}

interface StreamChunk {
  type: string;
  text?: string;
  content?: any;
  message?: any;
  result?: any;
}

export function MobileChatInput({ sessionId, projectPath, onMessageSent }: MobileChatInputProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [message]);

  // Auto-scroll response
  useEffect(() => {
    if (responseRef.current) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [responseText]);

  const sendMessage = useCallback(async () => {
    if (!message.trim() || sending) return;

    setSending(true);
    setResponseText('');
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(api(`/api/sessions/${sessionId}/chat`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), cwd: projectPath }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Failed to send message');
        setSending(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError('No response stream');
        setSending(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      setMessage('');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          try {
            const chunk: StreamChunk = JSON.parse(data);

            if (chunk.type === 'done') {
              onMessageSent?.();
            } else if (chunk.type === 'error') {
              setError(prev => (prev || '') + (chunk.text || ''));
            } else if (chunk.type === 'stderr') {
              const text = chunk.text || '';
              if (text.includes('Error') || text.includes('error')) {
                setError(prev => (prev || '') + text);
              }
            } else if (chunk.type === 'assistant') {
              const content = chunk.message?.content || chunk.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text' && block.text) {
                    fullText += block.text;
                    setResponseText(fullText);
                  }
                }
              }
            } else if (chunk.type === 'content_block_delta') {
              if (chunk.content?.type === 'text_delta' || chunk.text) {
                fullText += chunk.content?.text || chunk.text || '';
                setResponseText(fullText);
              }
            } else if (chunk.type === 'text') {
              fullText += chunk.text || '';
              setResponseText(fullText);
            } else if (chunk.type === 'result') {
              if (!fullText) {
                const result = (chunk as any).result;
                if (typeof result === 'string') {
                  fullText = result;
                  setResponseText(fullText);
                }
              }
              onMessageSent?.();
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Connection failed');
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [message, sending, sessionId, projectPath, onMessageSent]);

  const stopGeneration = () => {
    abortRef.current?.abort();
    setSending(false);
  };

  const handleVoiceTranscript = (text: string) => {
    setMessage(prev => prev ? `${prev} ${text}` : text);
    textareaRef.current?.focus();
  };

  return (
    <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-950 pb-[env(safe-area-inset-bottom)]">
      {/* Streaming response */}
      {(responseText || error || sending) && (
        <div className="border-b border-zinc-800">
          <div
            ref={responseRef}
            className="max-h-40 overflow-y-auto px-4 py-3 text-sm"
          >
            {error && (
              <div className="text-red-400 text-xs mb-2 bg-red-950/20 rounded px-3 py-2">
                {error}
              </div>
            )}
            {responseText && (
              <div className="prose prose-sm prose-invert max-w-none prose-pre:bg-zinc-800 prose-pre:text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {responseText}
                </ReactMarkdown>
              </div>
            )}
            {sending && !responseText && !error && (
              <div className="flex items-center gap-2 text-zinc-500 text-xs">
                <Loader2 className="w-3 h-3 animate-spin" />
                Waiting for Claude...
              </div>
            )}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-end gap-2 px-3 py-2">
        <VoiceInput onTranscript={handleVoiceTranscript} />

        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              sendMessage();
            }
          }}
          placeholder={sending ? 'Claude is thinking...' : 'Message...'}
          disabled={sending}
          rows={1}
          className={cn(
            'flex-1 resize-none rounded-xl border px-3 py-2 text-sm bg-zinc-900',
            'focus:outline-none focus:ring-1 focus:ring-indigo-500',
            'placeholder:text-zinc-600 border-zinc-700',
            'max-h-[120px]',
            sending && 'opacity-50'
          )}
        />

        {sending ? (
          <button
            onClick={stopGeneration}
            className="p-2.5 rounded-xl bg-red-500 text-white flex-shrink-0"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={sendMessage}
            disabled={!message.trim()}
            className={cn(
              'p-2.5 rounded-xl flex-shrink-0',
              message.trim()
                ? 'bg-indigo-500 text-white'
                : 'bg-zinc-800 text-zinc-600'
            )}
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
