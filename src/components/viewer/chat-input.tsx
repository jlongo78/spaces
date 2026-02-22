'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Square, Terminal, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatInputProps {
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
  exitCode?: number;
}

export function ChatInput({ sessionId, projectPath, onMessageSent }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [streamOutput, setStreamOutput] = useState<StreamChunk[]>([]);
  const [responseText, setResponseText] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [message]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [responseText, streamOutput]);

  const sendMessage = useCallback(async () => {
    if (!message.trim() || sending) return;

    setSending(true);
    setStreamOutput([]);
    setResponseText('');
    setError(null);
    setExpanded(true);

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
            setStreamOutput(prev => [...prev, chunk]);

            if (chunk.type === 'done') {
              // Refresh messages after Claude finishes
              onMessageSent?.();
            } else if (chunk.type === 'error') {
              setError(prev => (prev || '') + (chunk.text || ''));
            } else if (chunk.type === 'stderr') {
              // Show stderr but don't treat as fatal — could be warnings
              const text = chunk.text || '';
              if (text.includes('Error') || text.includes('error')) {
                setError(prev => (prev || '') + text);
              }
            } else if (chunk.type === 'assistant') {
              // Extract text from assistant message content
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
              // Streaming delta
              if (chunk.content?.type === 'text_delta' || chunk.text) {
                fullText += chunk.content?.text || chunk.text || '';
                setResponseText(fullText);
              }
            } else if (chunk.type === 'text') {
              fullText += chunk.text || '';
              setResponseText(fullText);
            } else if (chunk.type === 'result') {
              // Final result from --print mode — only use if we didn't get text from assistant
              if (!fullText) {
                const result = (chunk as any).result;
                if (typeof result === 'string') {
                  fullText = result;
                  setResponseText(fullText);
                }
              }
              // Trigger refresh since this means Claude is done
              onMessageSent?.();
            }
          } catch {
            // Ignore parse errors
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

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 flex-shrink-0">
      {/* Streaming response area */}
      {(responseText || error || sending) && (
        <div className="border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-2 px-4 py-1.5 text-[11px] text-muted-foreground hover:text-foreground bg-zinc-50 dark:bg-zinc-900/50"
          >
            {sending ? (
              <Loader2 className="w-3 h-3 animate-spin text-indigo-500" />
            ) : (
              <Terminal className="w-3 h-3" />
            )}
            <span className="font-medium">
              {sending ? 'Claude is responding...' : 'Response'}
            </span>
            {expanded ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronUp className="w-3 h-3 ml-auto" />}
          </button>

          {expanded && (
            <div
              ref={outputRef}
              className="max-h-64 overflow-y-auto px-4 py-3 text-sm"
            >
              {error && (
                <div className="text-red-500 text-xs mb-2 bg-red-50 dark:bg-red-950/20 rounded px-3 py-2">
                  {error}
                </div>
              )}
              {responseText && (
                <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-zinc-100 dark:prose-pre:bg-zinc-800 prose-pre:text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {responseText}
                  </ReactMarkdown>
                </div>
              )}
              {sending && !responseText && !error && (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Waiting for Claude...
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="px-4 py-3">
        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <div className="flex-1 relative">
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
              placeholder={sending ? 'Claude is thinking...' : 'Send a message to Claude...'}
              disabled={sending}
              rows={1}
              className={cn(
                'w-full resize-none rounded-lg border px-4 py-2.5 pr-12 text-sm bg-transparent',
                'focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent',
                'placeholder:text-muted-foreground/50',
                'border-zinc-200 dark:border-zinc-700',
                sending && 'opacity-50'
              )}
            />
            <div className="absolute right-2 bottom-2">
              {sending ? (
                <button
                  onClick={stopGeneration}
                  className="p-1.5 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
                  title="Stop generation"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={sendMessage}
                  disabled={!message.trim()}
                  className={cn(
                    'p-1.5 rounded-md transition-colors',
                    message.trim()
                      ? 'bg-indigo-500 text-white hover:bg-indigo-600'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-muted-foreground'
                  )}
                  title="Send (Enter)"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Enter to send, Shift+Enter for newline. Resumes this session via <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">claude --resume</code>
        </p>
      </div>
    </div>
  );
}
