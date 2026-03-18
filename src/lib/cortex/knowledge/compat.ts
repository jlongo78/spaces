/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export function layerToScope(layer: string, workspaceId?: number | null): any {
  return getCortexAddon()?.layerToScope?.(layer, workspaceId) ?? { level: 'personal' };
}

export function scopeToLayer(scope: any): string {
  return getCortexAddon()?.scopeToLayer?.(scope) ?? 'personal';
}

export function scopeToLayerKey(scope: any, workspaceId?: number | null): string {
  return getCortexAddon()?.scopeToLayerKey?.(scope, workspaceId) ?? 'personal';
}
