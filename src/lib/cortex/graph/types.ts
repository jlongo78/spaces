export const ENTITY_TYPES = [
  'person', 'team', 'department', 'organization',
  'project', 'system', 'module', 'topic',
] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const EDGE_RELATIONS = [
  'member_of', 'belongs_to', 'part_of',
  'works_on', 'expert_in', 'touches', 'owns', 'contains', 'depends_on', 'relates_to',
  'created_by', 'about', 'scoped_to', 'derived_from',
] as const;
export type EdgeRelation = typeof EDGE_RELATIONS[number];

export interface Entity {
  id: string;
  type: EntityType;
  name: string;
  metadata: Record<string, unknown>;
  created: string;
  updated: string;
}

export interface Edge {
  source_id: string;
  target_id: string;
  relation: EdgeRelation;
  weight: number;
  metadata: Record<string, unknown>;
  created: string;
}

export interface EntityAlias {
  entity_id: string;
  alias: string;
}

export interface AccessGrant {
  knowledge_id: string;
  grantee_entity_id: string;
  granted_by: string;
  created: string;
}

export function entityId(type: EntityType, slug: string): string {
  return `${type}-${slug}`;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function isValidEntityType(s: string): s is EntityType {
  return ENTITY_TYPES.includes(s as EntityType);
}

export function isValidEdgeRelation(s: string): s is EdgeRelation {
  return EDGE_RELATIONS.includes(s as EdgeRelation);
}
