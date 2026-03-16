import { describe, it, expect } from 'vitest';
import { layerToScope, scopeToLayer, scopeToLayerKey, layerKeyToScope } from '@/lib/cortex/knowledge/compat';

describe('v1↔v2 Compatibility', () => {
  describe('layerToScope', () => {
    it('maps personal to personal scope', () => {
      const scope = layerToScope('personal', null, 'default-user');
      expect(scope).toEqual({ level: 'personal', entity_id: 'person-default-user' });
    });
    it('maps workspace to team scope', () => {
      expect(layerToScope('workspace', 42)).toEqual({ level: 'team', entity_id: 'team-default' });
    });
    it('maps team to organization scope', () => {
      expect(layerToScope('team', null)).toEqual({ level: 'organization', entity_id: 'organization-default' });
    });
  });

  describe('scopeToLayer', () => {
    it('maps personal scope to personal layer', () => {
      expect(scopeToLayer({ level: 'personal', entity_id: 'person-alice' })).toBe('personal');
    });
    it('maps team scope to workspace layer', () => {
      expect(scopeToLayer({ level: 'team', entity_id: 'team-platform' })).toBe('workspace');
    });
    it('maps department scope to team layer', () => {
      expect(scopeToLayer({ level: 'department', entity_id: 'dept-eng' })).toBe('team');
    });
    it('maps organization scope to team layer', () => {
      expect(scopeToLayer({ level: 'organization', entity_id: 'org-acme' })).toBe('team');
    });
  });

  describe('scopeToLayerKey', () => {
    it('maps personal scope to personal key', () => {
      expect(scopeToLayerKey({ level: 'personal', entity_id: 'person-alice' })).toBe('personal');
    });
    it('maps team scope with workspace_id to workspace/id key', () => {
      expect(scopeToLayerKey({ level: 'team', entity_id: 'team-platform' }, 42)).toBe('workspace/42');
    });
    it('maps team scope without workspace_id to team key', () => {
      expect(scopeToLayerKey({ level: 'team', entity_id: 'team-platform' })).toBe('team');
    });
  });

  describe('layerKeyToScope', () => {
    it('maps personal key to personal scope', () => {
      expect(layerKeyToScope('personal', 'default-user')).toEqual({ level: 'personal', entity_id: 'person-default-user' });
    });
    it('maps workspace/id key to team scope', () => {
      expect(layerKeyToScope('workspace/42')).toEqual({ level: 'team', entity_id: 'team-default' });
    });
  });
});
