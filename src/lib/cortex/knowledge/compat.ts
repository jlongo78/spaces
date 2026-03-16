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
  switch (scope.level) {
    case 'personal': return 'personal';
    case 'team': return 'workspace';
    case 'department':
    case 'organization': return 'team';
  }
}

export function scopeToLayerKey(scope: Scope, workspaceId?: number | null): string {
  switch (scope.level) {
    case 'personal': return 'personal';
    case 'team':
      return workspaceId ? `workspace/${workspaceId}` : 'team';
    case 'department':
    case 'organization':
      return 'team';
  }
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
