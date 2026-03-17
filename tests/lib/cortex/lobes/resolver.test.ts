import { describe, it, expect } from 'vitest';
import { resolveLobes } from '@/lib/cortex/lobes/resolver';
import { DEFAULT_LOBE_CONFIG } from '@/lib/cortex/lobes/config';

// Test setup — 4 workspaces:
// 1. Auth Service (id=1, default config)
// 2. Frontend (id=2, default config)
// 3. Private Project (id=3, isPrivate: true)
// 4. Excluded (id=4, excludedFrom: [1])

const allWorkspaces = [
  { id: 1, name: 'Auth Service', lobeConfig: { ...DEFAULT_LOBE_CONFIG } },
  { id: 2, name: 'Frontend', lobeConfig: { ...DEFAULT_LOBE_CONFIG } },
  { id: 3, name: 'Private Project', lobeConfig: { ...DEFAULT_LOBE_CONFIG, isPrivate: true } },
  { id: 4, name: 'Excluded', lobeConfig: { ...DEFAULT_LOBE_CONFIG, excludedFrom: [1] } },
];

describe('resolveLobes', () => {
  it('includes own workspace lobe', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces });
    const own = lobes.find((l) => l.type === 'own');
    expect(own).toBeDefined();
    expect(own!.id).toBe('1');
    expect(own!.label).toBe('Auth Service');
    expect(own!.layerKey).toBe('workspace:1');
  });

  it('includes personal lobe', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces, userId: 'user-42' });
    const personal = lobes.find((l) => l.type === 'personal');
    expect(personal).toBeDefined();
    expect(personal!.id).toBe('user-42');
    expect(personal!.layerKey).toBe('user:user-42');
  });

  it('includes other non-private workspaces by default', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces });
    const wsFrontend = lobes.find((l) => l.id === '2' && l.type === 'workspace');
    expect(wsFrontend).toBeDefined();
    expect(wsFrontend!.label).toBe('Frontend');
  });

  it('excludes private workspaces', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces });
    const privateWs = lobes.find((l) => l.id === '3' && l.type === 'workspace');
    expect(privateWs).toBeUndefined();
  });

  it('excludes workspaces that exclude the requester', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces });
    // workspace 4 has excludedFrom: [1], so workspace 1 should not see it
    const excludedWs = lobes.find((l) => l.id === '4' && l.type === 'workspace');
    expect(excludedWs).toBeUndefined();
  });

  it('includes team lobe by default', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces });
    const team = lobes.find((l) => l.type === 'team');
    expect(team).toBeDefined();
    expect(team!.layerKey).toBe('team:default');
  });

  it('includes explicit subscriptions', () => {
    const workspacesWithSub = allWorkspaces.map((w) =>
      w.id === 1
        ? {
            ...w,
            lobeConfig: {
              ...w.lobeConfig,
              subscriptions: [{ type: 'department' as const, id: 'eng', label: 'Engineering' }],
            },
          }
        : w,
    );
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: workspacesWithSub });
    const sub = lobes.find((l) => l.layerKey === 'department:eng');
    expect(sub).toBeDefined();
    expect(sub!.label).toBe('Engineering');
    expect(sub!.type).toBe('department');
  });

  it('assigns lower weight to subscribed lobes vs inherited (own 1.0 > subscribed 0.4)', () => {
    const workspacesWithSub = allWorkspaces.map((w) =>
      w.id === 1
        ? {
            ...w,
            lobeConfig: {
              ...w.lobeConfig,
              subscriptions: [{ type: 'tag' as const, id: 'security', label: 'Security' }],
            },
          }
        : w,
    );
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: workspacesWithSub });
    const own = lobes.find((l) => l.type === 'own')!;
    const sub = lobes.find((l) => l.layerKey === 'tag:security')!;
    expect(own.baseWeight).toBe(1.0);
    expect(sub.baseWeight).toBe(0.4);
    expect(own.baseWeight).toBeGreaterThan(sub.baseWeight);
  });
});
