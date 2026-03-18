/** Stub — type definitions for build-time compatibility */
export const ENTITY_TYPES = ['person', 'team', 'project', 'system', 'module', 'topic', 'department', 'organization'] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const EDGE_RELATIONS = ['owns', 'works_on', 'part_of', 'contains', 'depends_on', 'relates_to', 'expert_in'] as const;
export type EdgeRelation = typeof EDGE_RELATIONS[number];

export function isValidEntityType(t: string): t is EntityType {
  return ENTITY_TYPES.includes(t as any);
}

export function isValidEdgeRelation(r: string): r is EdgeRelation {
  return EDGE_RELATIONS.includes(r as any);
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function entityId(type: EntityType, slug: string): string {
  return `${type}-${slug}`;
}
