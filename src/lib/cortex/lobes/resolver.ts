import { LobeConfig } from './config';

export interface ResolvedLobe {
  layerKey: string;
  label: string;
  type: 'own' | 'personal' | 'workspace' | 'team' | 'department' | 'organization' | 'tag' | 'user';
  id: string;
  baseWeight: number;
  inherited: boolean;
}

interface WorkspaceInfo {
  id: number;
  name: string;
  lobeConfig: LobeConfig;
}

interface ResolveInput {
  workspaceId: number;
  allWorkspaces: WorkspaceInfo[];
  userId?: string;
}

export function resolveLobes(input: ResolveInput): ResolvedLobe[] {
  const { workspaceId, allWorkspaces, userId } = input;
  const seen = new Set<string>();
  const lobes: ResolvedLobe[] = [];

  const add = (lobe: ResolvedLobe) => {
    if (!seen.has(lobe.layerKey)) {
      seen.add(lobe.layerKey);
      lobes.push(lobe);
    }
  };

  // 1. Own workspace (weight 1.0)
  const own = allWorkspaces.find((w) => w.id === workspaceId);
  if (own) {
    add({
      layerKey: `workspace/${workspaceId}`,
      label: own.name,
      type: 'own',
      id: String(workspaceId),
      baseWeight: 1.0,
      inherited: false,
    });
  }

  // 2. Personal lobe (weight 0.9) — include legacy 'personal' key for backward compat
  add({
    layerKey: 'personal',
    label: 'Personal',
    type: 'personal',
    id: userId ?? 'personal',
    baseWeight: 0.9,
    inherited: false,
  });

  // 3. Sibling workspaces that are not private and don't exclude this workspace (weight 0.6)
  for (const ws of allWorkspaces) {
    if (ws.id === workspaceId) continue;
    if (ws.lobeConfig.isPrivate) continue;
    if (ws.lobeConfig.excludedFrom.includes(workspaceId)) continue;
    add({
      layerKey: `workspace/${ws.id}`,
      label: ws.name,
      type: 'workspace',
      id: String(ws.id),
      baseWeight: 0.6,
      inherited: true,
    });
  }

  // 3b. Legacy 'workspace' layer (pre-lobe data from bootstrap, weight 0.5)
  add({
    layerKey: 'workspace',
    label: 'Workspace (legacy)',
    type: 'workspace',
    id: 'legacy',
    baseWeight: 0.5,
    inherited: true,
  });

  // 4. Team lobe (weight 0.5)
  add({
    layerKey: 'team/default',
    label: 'Team',
    type: 'team',
    id: 'default',
    baseWeight: 0.5,
    inherited: true,
  });

  // 5. Explicit subscriptions from config (weight 0.4)
  if (own) {
    for (const sub of own.lobeConfig.subscriptions) {
      const layerKey = `${sub.type}/${sub.id}`;
      add({
        layerKey,
        label: sub.label,
        type: sub.type as ResolvedLobe['type'],
        id: sub.id,
        baseWeight: 0.4,
        inherited: true,
      });
    }
  }

  return lobes;
}
