'use client';

import type { ProjectPlan } from './project-wizard';
import { Terminal, Sparkles } from 'lucide-react';

const AGENT_COLORS: Record<string, string> = {
  claude: '#6366f1',
  codex: '#22c55e',
  gemini: '#3b82f6',
  aider: '#f59e0b',
  shell: '#78716c',
  custom: '#a855f7',
};

export function WizardPlanSummary({
  plan,
  onReview,
}: {
  plan: ProjectPlan | null;
  onReview: () => void;
}) {
  if (!plan) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <Sparkles className="w-8 h-8 text-zinc-700 mb-3" />
        <p className="text-zinc-500 text-sm">Your project plan will appear here as you chat.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {/* Workspace */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Workspace</div>
          <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: plan.workspace.color }} />
              <span className="text-sm font-medium text-zinc-200">{plan.workspace.name}</span>
            </div>
            {plan.workspace.description && (
              <p className="text-xs text-zinc-400 mt-1">{plan.workspace.description}</p>
            )}
          </div>
        </div>

        {/* Panes */}
        {plan.panes.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">
              Panes ({plan.panes.length})
            </div>
            <div className="space-y-2">
              {plan.panes.map((pane, i) => (
                <div key={i} className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Terminal className="w-3 h-3 text-zinc-500" />
                    <span className="text-xs font-medium text-zinc-200">{pane.title}</span>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                      style={{
                        backgroundColor: `${AGENT_COLORS[pane.agentType] || '#6366f1'}20`,
                        color: AGENT_COLORS[pane.agentType] || '#6366f1',
                      }}
                    >
                      {pane.agentType}
                    </span>
                  </div>
                  {pane.description && (
                    <p className="text-[11px] text-zinc-500 mt-1">{pane.description}</p>
                  )}
                  {pane.cwd && (
                    <p className="text-[10px] text-zinc-600 font-mono mt-1">{pane.cwd}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary */}
        {plan.summary && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5">Summary</div>
            <p className="text-xs text-zinc-400">{plan.summary}</p>
          </div>
        )}
      </div>

      {/* Review button */}
      <div className="px-5 py-3 border-t border-zinc-800 flex-shrink-0">
        <button
          onClick={onReview}
          disabled={!plan.panes.length}
          className="w-full py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg transition-colors"
        >
          Review Plan
        </button>
      </div>
    </div>
  );
}
