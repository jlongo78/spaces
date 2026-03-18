import type { Layer, Scope } from './types';

export function layerToScope(layer: Layer, workspaceId?: number | null, userId?: string): Scope {
  switch (layer) {
    case 'personal':
      return { level: 'personal', entity_id: `person-${userId ?? 'default-user'}` };
    case 'workspace':
      return { level: 'team', entity_id: 'team-default' };
    case 'team':
      return { level: 'organization', entity_id: 'organization-default' };
  }
}

export function scopeToLayer(scope: Scope): Layer {
  const level = scope.level as string;
  if (level === 'personal') return 'personal';
  if (level === 'workspace' || level === 'team') return 'workspace';
  if (level === 'department' || level === 'organization') return 'team';
  return 'personal';
}

export function scopeToLayerKey(scope: Scope, workspaceId?: number | null): string {
  const level = scope.level as string;
  if (level === 'personal') return 'personal';
  if (level === 'workspace' || level === 'team') return workspaceId ? `workspace/${workspaceId}` : 'workspace';
  if (level === 'department' || level === 'organization') return 'team';
  return workspaceId ? `workspace/${workspaceId}` : 'personal';
}

export function layerKeyToScope(layerKey: string, userId?: string): Scope {
  if (layerKey === 'personal') {
    return { level: 'personal', entity_id: `person-${userId ?? 'default-user'}` };
  }
  if (layerKey.startsWith('workspace/')) {
    return { level: 'team', entity_id: 'team-default' };
  }
  return { level: 'organization', entity_id: 'organization-default' };
}
