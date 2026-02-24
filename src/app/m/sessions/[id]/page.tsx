'use client';

import { useState, useEffect, useRef, useCallback, use } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession, useMessages, useToggleStar } from '@/hooks/use-sessions';
import { MessageRenderer } from '@/components/viewer/message-renderer';
import { MobileHeader } from '@/components/mobile/mobile-header';
import { MobileChatInput } from '@/components/mobile/mobile-chat-input';
import { Star, Loader2, FolderOpen, MessageSquare } from 'lucide-react';
import { cn, truncate, formatRelativeTime } from '@/lib/utils';

export default function MobileSessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [allMessages, setAllMessages] = useState<any[]>([]);
  const [loadedPages, setLoadedPages] = useState(0);
  const limit = 50;
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: session, isLoading: sessionLoading } = useSession(id);
  const { data: messagesData, isLoading: messagesLoading } = useMessages(id, loadedPages * limit, limit);
  const toggleStar = useToggleStar();
  const queryClient = useQueryClient();

  const refreshMessages = useCallback(() => {
    setTimeout(() => {
      setLoadedPages(0);
      setAllMessages([]);
      queryClient.invalidateQueries({ queryKey: ['messages', id] });
      queryClient.invalidateQueries({ queryKey: ['session', id] });
    }, 1500);
  }, [id, queryClient]);

  // Accumulate messages
  useEffect(() => {
    if (messagesData?.messages && messagesData.messages.length > 0) {
      if (loadedPages === 0) {
        setAllMessages(messagesData.messages);
      } else {
        setAllMessages(prev => [...prev, ...messagesData.messages]);
      }
    }
  }, [messagesData, loadedPages]);

  // Auto-scroll to bottom on initial load
  useEffect(() => {
    if (allMessages.length > 0 && loadedPages === 0) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }, 100);
    }
  }, [allMessages.length, loadedPages]);

  const loadMore = useCallback(() => {
    if (!messagesLoading && messagesData?.hasMore) {
      setLoadedPages(p => p + 1);
    }
  }, [messagesLoading, messagesData?.hasMore]);

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center h-[80dvh]">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <MobileHeader title="Session" showBack backHref="/m/sessions" />
        <div className="p-6 text-center">
          <p className="text-red-500 text-sm">Session not found.</p>
        </div>
      </>
    );
  }

  const title = session.customName || session.summary || truncate(session.firstPrompt, 60);
  const messages = allMessages;
  const totalMessages = messagesData?.total || session.messageCount;
  const hasMore = messagesData?.hasMore ?? true;

  return (
    <div className="flex flex-col h-[100dvh]">
      {/* Header */}
      <MobileHeader
        title={title}
        showBack
        backHref="/m/sessions"
        right={
          <button
            onClick={() => toggleStar.mutate(session.id)}
            className="p-1.5"
          >
            <Star
              className={cn(
                'w-5 h-5',
                session.starred ? 'text-amber-500 fill-amber-500' : 'text-zinc-500'
              )}
            />
          </button>
        }
      />

      {/* Session meta bar */}
      <div className="flex items-center gap-3 px-4 py-2 text-[11px] text-zinc-500 border-b border-zinc-800 flex-shrink-0">
        <span className="flex items-center gap-1 text-indigo-400/70">
          <FolderOpen className="w-3 h-3" />
          {session.projectName}
        </span>
        <span className="flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          {totalMessages}
        </span>
        <span className="ml-auto">{formatRelativeTime(session.modified)}</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 space-y-4">
          {messagesLoading && messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
              <span className="text-xs text-zinc-500">Loading conversation...</span>
            </div>
          ) : (
            <>
              {hasMore && (
                <div className="text-center py-2">
                  <button
                    onClick={loadMore}
                    disabled={messagesLoading}
                    className="px-4 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 disabled:opacity-50"
                  >
                    {messagesLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin inline mr-1.5" />
                    ) : null}
                    Load earlier ({totalMessages - messages.length} more)
                  </button>
                </div>
              )}

              {messages.map((msg, i) => (
                <MessageRenderer
                  key={msg.uuid || `msg-${i}`}
                  message={msg}
                  isLast={i === messages.length - 1}
                />
              ))}

              {!hasMore && messages.length > 0 && (
                <p className="text-center text-[11px] text-zinc-600 py-2">End of conversation</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Chat input */}
      <MobileChatInput
        sessionId={id}
        projectPath={session.projectPath}
        onMessageSent={refreshMessages}
      />
    </div>
  );
}
