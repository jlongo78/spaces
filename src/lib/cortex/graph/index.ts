export { EntityGraph } from './entity-graph';
export { EntityResolver } from './resolver';
export { autoPopulate } from './auto-populate';
export type { AutoPopulateConfig } from './auto-populate';
export { initGraphSchema } from './schema';
export {
  entityId,
  slugify,
  isValidEntityType,
  isValidEdgeRelation,
  ENTITY_TYPES,
  EDGE_RELATIONS,
} from './types';
export type {
  Entity,
  Edge,
  EntityType,
  EdgeRelation,
  EntityAlias,
  AccessGrant,
} from './types';
