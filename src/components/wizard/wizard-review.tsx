'use client';

import { ArrowLeft, Plus, Trash2, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ProjectPlan } from './project-wizard';
import { api } from '@/lib/api';

const AGENT_TYPES = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'aider', label: 'Aider' },
  { value: 'forge', label: 'Forge' },
  { value: 'shell', label: 'Shell' },
  { value: 'custom', label: 'Custom' },
];

const COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#78716c',
];

interface CustomModel {
  id: string;
  name: string;
}

export function WizardReview({
  plan,
  onUpdate,
  onBack,
  onLaunch,
}: {
  plan: ProjectPlan;
  onUpdate: (plan: ProjectPlan) => void;
  onBack: () => void;
  onLaunch: () => void;
}) {
  const [customModels, setCustomModels] = useState<CustomModel[]>([]);

  useEffect(() => {
    fetch(api('/api/config'))
      .then(r => r.json())
      .then(d => {
        if (d.customModels) setCustomModels(d.customModels);
      })
      .catch(() => {});
  }, []);

  const updateWorkspace = (key: string, value: string) => {
    onUpdate({ ...plan, workspace: { ...plan.workspace, [key]: value } });
  };

  const updatePane = (index: number, key: string, value: string) => {
    const panes = [...plan.panes];
    panes[index] = { ...panes[index], [key]: value };
    onUpdate({ ...plan, panes });
  };

  const removePane = (index: number) => {
    onUpdate({ ...plan, panes: plan.panes.filter((_, i) => i !== index) });
  };

  const addPane = () => {
    onUpdate({
      ...plan,
      panes: [...plan.panes, { title: 'New Pane', agentType: 'claude', cwd: '~', description: '' }],
    });
  };

  const canLaunch = plan.workspace.name.trim() && plan.panes.length > 0 && plan.panes.every(p => p.cwd.trim());

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Chat
        </button>
        <button
          onClick={onLaunch}
          disabled={!canLaunch}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg transition-colors"
        >
          <Rocket className="w-3.5 h-3.5" />
          Launch Space
        </button>
      </div>

      {/* Workspace config */}
      <div className="bg-zinc-900 rounded-lg border border-zinc-700 p-4 space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500">Workspace</div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-[10px] text-zinc-500 block mb-1">Name</label>
            <input
              value={plan.workspace.name}
              onChange={(e) => updateWorkspace('name', e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 block mb-1">Color</label>
            <div className="flex gap-1 flex-wrap" style={{ width: 128 }}>
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => updateWorkspace('color', c)}
                  className={`w-5 h-5 rounded-full ${plan.workspace.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-zinc-900' : 'hover:ring-1 hover:ring-zinc-500'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Description</label>
          <textarea
            value={plan.workspace.description}
            onChange={(e) => updateWorkspace('description', e.target.value)}
            rows={2}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500 resize-none"
          />
        </div>
      </div>

      {/* Panes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Panes ({plan.panes.length})</div>
          <button onClick={addPane} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white">
            <Plus className="w-3 h-3" /> Add Pane
          </button>
        </div>

        {plan.panes.map((pane, i) => (
          <div key={i} className="bg-zinc-900 rounded-lg border border-zinc-700 p-4 space-y-2.5">
            <div className="flex items-start gap-3">
              <div className="flex-1 space-y-2.5">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] text-zinc-500 block mb-1">Title</label>
                    <input
                      value={pane.title}
                      onChange={(e) => updatePane(i, 'title', e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <div className="w-32">
                    <label className="text-[10px] text-zinc-500 block mb-1">Agent</label>
                    <select
                      value={pane.agentType}
                      onChange={(e) => updatePane(i, 'agentType', e.target.value)}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                    >
                      {AGENT_TYPES.map(a => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                  {pane.agentType === 'forge' && customModels.length > 0 && (
                    <div className="w-40">
                      <label className="text-[10px] text-zinc-500 block mb-1">Custom Model</label>
                      <select
                        value={pane.customModelId || ''}
                        onChange={(e) => updatePane(i, 'customModelId', e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
                      >
                        <option value="">Default</option>
                        {customModels.map(m => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Working Directory</label>
                  <input
                    value={pane.cwd}
                    onChange={(e) => updatePane(i, 'cwd', e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500"
                    placeholder="/path/to/project"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-zinc-500 block mb-1">Initial Prompt (optional)</label>
                  <textarea
                    value={pane.initialPrompt || ''}
                    onChange={(e) => updatePane(i, 'initialPrompt', e.target.value)}
                    rows={2}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500 resize-none"
                    placeholder="What should this agent start working on?"
                  />
                </div>
              </div>
              <button
                onClick={() => removePane(i)}
                className="text-zinc-600 hover:text-red-400 mt-4"
                title="Remove pane"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom launch button */}
      <div className="flex justify-end pt-2">
        <button
          onClick={onLaunch}
          disabled={!canLaunch}
          className="flex items-center gap-1.5 px-6 py-2.5 text-sm font-medium bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg transition-colors"
        >
          <Rocket className="w-4 h-4" />
          Launch Space
        </button>
      </div>
    </div>
  );
}
