'use client';

import { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { WizardChat } from './wizard-chat';
import { WizardPlanSummary } from './wizard-plan-summary';
import { WizardReview } from './wizard-review';
import { api } from '@/lib/api';

export interface ProjectPlan {
  workspace: {
    name: string;
    description: string;
    color: string;
  };
  panes: Array<{
    title: string;
    agentType: 'claude' | 'codex' | 'gemini' | 'aider' | 'shell' | 'custom';
    cwd: string;
    initialPrompt?: string;
    customCommand?: string;
    description: string;
  }>;
  summary: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function ProjectWizard({
  isOpen,
  onClose,
  onLaunch,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: (workspaceId: number) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'chat' | 'review'>('chat');
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: Message = { role: 'user', content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(api('/api/wizard/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated, currentPlan: plan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setMessages([...updated, { role: 'assistant', content: data.reply }]);
      if (data.plan) setPlan(data.plan);
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [messages, plan]);

  const handleLaunch = useCallback(async () => {
    if (!plan) return;
    try {
      // Create workspace
      const wsRes = await fetch(api('/api/workspaces'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: plan.workspace.name,
          description: plan.workspace.description,
          color: plan.workspace.color,
        }),
      });
      const ws = await wsRes.json();
      const wsId = ws.id;

      // Create panes
      for (const pane of plan.panes) {
        await fetch(api('/api/panes'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: pane.title,
            agentType: pane.agentType,
            cwd: pane.cwd,
            customCommand: pane.customCommand,
            workspaceId: wsId,
          }),
        });
      }

      onLaunch(wsId);
      onClose();
    } catch (e: any) {
      setError(e.message);
    }
  }, [plan, onLaunch, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/95 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 flex-shrink-0">
        <h2 className="text-sm font-semibold text-zinc-100">Plan a Project</h2>
        <button onClick={onClose} className="text-zinc-500 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="px-6 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {phase === 'chat' ? (
          <>
            <div className="flex-1 flex flex-col border-r border-zinc-800 min-w-0">
              <WizardChat messages={messages} onSend={sendMessage} loading={loading} />
            </div>
            <div className="w-[380px] flex-shrink-0 overflow-y-auto">
              <WizardPlanSummary plan={plan} onReview={() => setPhase('review')} />
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <WizardReview
              plan={plan!}
              onUpdate={setPlan}
              onBack={() => setPhase('chat')}
              onLaunch={handleLaunch}
            />
          </div>
        )}
      </div>
    </div>
  );
}
