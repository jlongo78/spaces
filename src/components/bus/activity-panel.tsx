'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Send, Check, X, ChevronRight, ChevronLeft, Trash2 } from 'lucide-react';
import {
  useWorkspaceMessages,
  usePostMessage,
  useUpdateMessageStatus,
  useClearMessages,
  useWorkspaceContext,
  useSetContext,
  useDeleteContext,
  useClearContext,
  type WorkspaceMessage,
} from '@/hooks/use-bus';

interface ActivityPanelProps {
  workspaceId: number | null;
  panes: { id: string; title: string; agentType?: string; color?: string }[];
  collapsed: boolean;
  onToggle: () => void;
}

export function ActivityPanel({ workspaceId, panes, collapsed, onToggle }: ActivityPanelProps) {
  const [tab, setTab] = useState<'messages' | 'context'>('messages');
  const [compose, setCompose] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  const { data: messages = [] } = useWorkspaceMessages(workspaceId);
  const { data: context = [] } = useWorkspaceContext(workspaceId);
  const postMessage = usePostMessage(workspaceId);
  const updateStatus = useUpdateMessageStatus(workspaceId);
  const clearMessages = useClearMessages(workspaceId);
  const clearContext = useClearContext(workspaceId);

  const pendingCount = messages.filter((m: WorkspaceMessage) => m.status === 'pending_approval').length;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!compose.trim() || !workspaceId) return;
    postMessage.mutate({ content: compose.trim() });
    setCompose('');
  };

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        className="flex-shrink-0 w-10 border-l border-zinc-800 bg-zinc-900 flex flex-col items-center pt-3 gap-2"
      >
        <ChevronLeft className="w-4 h-4 text-zinc-400" />
        <MessageSquare className="w-4 h-4 text-zinc-400" />
        {pendingCount > 0 && (
          <span className="bg-amber-500 text-black text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {pendingCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex-shrink-0 w-80 border-l border-zinc-800 bg-zinc-900 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('messages')}
            className={`px-2 py-1 text-xs rounded ${tab === 'messages' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
          >
            Messages
            {pendingCount > 0 && (
              <span className="ml-1 bg-amber-500 text-black text-xs font-bold rounded-full px-1.5">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('context')}
            className={`px-2 py-1 text-xs rounded ${tab === 'context' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
          >
            Context
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => tab === 'messages' ? clearMessages.mutate() : clearContext.mutate()}
            className="text-zinc-500 hover:text-red-400"
            title={tab === 'messages' ? 'Clear all messages' : 'Clear all context'}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onToggle} className="text-zinc-400 hover:text-zinc-300">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Message Feed */}
      {tab === 'messages' && (
        <>
          <div ref={feedRef} className="flex-1 overflow-y-auto p-2 space-y-2">
            {[...messages].reverse().map((msg: WorkspaceMessage) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                panes={panes}
                onApprove={() => updateStatus.mutate({ messageId: msg.id, status: 'approved' })}
                onReject={() => updateStatus.mutate({ messageId: msg.id, status: 'rejected' })}
              />
            ))}
            {messages.length === 0 && (
              <p className="text-zinc-500 text-xs text-center py-8">No messages yet. Agents will appear here.</p>
            )}
          </div>

          {/* Compose bar */}
          <div className="border-t border-zinc-800 p-2">
            <div className="flex gap-1">
              <input
                value={compose}
                onChange={(e) => setCompose(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                placeholder="Message workspace..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600"
              />
              <button
                onClick={handleSend}
                disabled={!compose.trim()}
                className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-sm"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Context Tab */}
      {tab === 'context' && (
        <ContextTab workspaceId={workspaceId} context={context} />
      )}
    </div>
  );
}

function MessageBubble({
  message,
  panes,
  onApprove,
  onReject,
}: {
  message: WorkspaceMessage;
  panes: { id: string; title: string; color?: string }[];
  onApprove: () => void;
  onReject: () => void;
}) {
  const pane = panes.find((p) => p.id === message.paneId);
  const isPending = message.status === 'pending_approval';
  const isRejected = message.status === 'rejected';

  return (
    <div className={`rounded p-2 text-xs ${isPending ? 'bg-amber-950/50 border border-amber-800/50' : isRejected ? 'bg-zinc-800/50 opacity-50' : 'bg-zinc-800/50'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-zinc-300">
          {pane && (
            <span
              className="inline-block w-2 h-2 rounded-full mr-1"
              style={{ backgroundColor: pane.color || '#6366f1' }}
            />
          )}
          {message.senderName}
        </span>
        <span className="text-zinc-500">{new Date(message.created).toLocaleTimeString()}</span>
      </div>
      <p className="text-zinc-300 whitespace-pre-wrap">{message.content}</p>
      {isPending && (
        <div className="flex gap-1 mt-2">
          <button onClick={onApprove} className="flex items-center gap-1 px-2 py-0.5 bg-green-700 hover:bg-green-600 rounded text-white text-xs">
            <Check className="w-3 h-3" /> Approve
          </button>
          <button onClick={onReject} className="flex items-center gap-1 px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 text-xs">
            <X className="w-3 h-3" /> Reject
          </button>
        </div>
      )}
      {message.status === 'rejected' && (
        <span className="text-red-400 text-xs mt-1 block">Rejected</span>
      )}
    </div>
  );
}

function ContextTab({
  workspaceId,
  context,
}: {
  workspaceId: number | null;
  context: { key: string; value: string; updatedBy: string; updated: string }[];
}) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const setContext = useSetContext(workspaceId);
  const deleteContext = useDeleteContext(workspaceId);

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setContext.mutate({ key: newKey.trim(), value: newValue.trim() });
    setNewKey('');
    setNewValue('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-2">
      {context.map((entry) => (
        <div key={entry.key} className="bg-zinc-800/50 rounded p-2 text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono font-medium text-indigo-300">{entry.key}</span>
            <button
              onClick={() => deleteContext.mutate(entry.key)}
              className="text-zinc-500 hover:text-red-400"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <p className="text-zinc-300 whitespace-pre-wrap font-mono text-xs">{entry.value}</p>
          <span className="text-zinc-500 text-xs">by {entry.updatedBy}</span>
        </div>
      ))}

      <div className="border-t border-zinc-800 pt-2 space-y-1">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="Key"
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={!newKey.trim() || !newValue.trim()}
          className="w-full px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-xs"
        >
          Add Entry
        </button>
      </div>
    </div>
  );
}
