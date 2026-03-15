import Database from 'better-sqlite3';
import { initGraphSchema } from './schema';
import { entityId, slugify } from './types';
import type { Entity, EntityType, Edge, EdgeRelation } from './types';

interface CreateEntityInput {
  id?: string;
  type: EntityType;
  name: string;
  metadata?: Record<string, unknown>;
}

interface UpdateEntityInput {
  name?: string;
  metadata?: Record<string, unknown>;
}

interface ListEntitiesFilter {
  type?: EntityType;
  limit?: number;
}

interface EntityRow {
  id: string;
  type: string;
  name: string;
  metadata: string;
  created: string;
  updated: string;
}

export interface CreateEdgeInput {
  source_id: string;
  target_id: string;
  relation: EdgeRelation;
  weight?: number;
  metadata?: Record<string, unknown>;
}

interface EdgeRow {
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  metadata: string;
  created: string;
}

export class EntityGraph {
  private db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    initGraphSchema(this.db);
  }

  // ---------------------------------------------------------------------------
  // Entity CRUD
  // ---------------------------------------------------------------------------

  createEntity(input: CreateEntityInput): Entity {
    const now = new Date().toISOString();
    const id = input.id ?? entityId(input.type, slugify(input.name));
    const metadata = input.metadata ?? {};

    this.db
      .prepare(
        `INSERT INTO entities (id, type, name, metadata, created, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.type, input.name, JSON.stringify(metadata), now, now);

    // Auto-add aliases: lowercased name and slugified name
    const lowerName = input.name.toLowerCase();
    const slugName = slugify(input.name);
    this.addAlias(id, lowerName);
    this.addAlias(id, slugName);

    return { id, type: input.type, name: input.name, metadata, created: now, updated: now };
  }

  getEntity(id: string): Entity | null {
    const row = this.db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(id) as EntityRow | undefined;

    return row ? this.rowToEntity(row) : null;
  }

  updateEntity(id: string, updates: UpdateEntityInput): Entity | null {
    const existing = this.getEntity(id);
    if (!existing) return null;

    // Ensure updated is strictly after created/previous updated
    const prevMs = new Date(existing.updated).getTime();
    const nowMs = Date.now();
    const now = new Date(Math.max(nowMs, prevMs + 1)).toISOString();
    const newName = updates.name ?? existing.name;
    const newMetadata = updates.metadata ?? existing.metadata;

    this.db
      .prepare('UPDATE entities SET name = ?, metadata = ?, updated = ? WHERE id = ?')
      .run(newName, JSON.stringify(newMetadata), now, id);

    return { ...existing, name: newName, metadata: newMetadata, updated: now };
  }

  deleteEntity(id: string): void {
    this.db.prepare('DELETE FROM entities WHERE id = ?').run(id);
  }

  listEntities(filter?: ListEntitiesFilter): Entity[] {
    const limit = filter?.limit;
    let sql = 'SELECT * FROM entities';
    const params: unknown[] = [];

    if (filter?.type) {
      sql += ' WHERE type = ?';
      params.push(filter.type);
    }

    sql += ' ORDER BY name';

    if (limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const rows = this.db.prepare(sql).all(...params) as EntityRow[];
    return rows.map(row => this.rowToEntity(row));
  }

  // ---------------------------------------------------------------------------
  // Edge CRUD
  // ---------------------------------------------------------------------------

  createEdge(input: CreateEdgeInput): Edge {
    const now = new Date().toISOString();
    const weight = input.weight ?? 1.0;
    const metadata = input.metadata ?? {};

    this.db
      .prepare(
        `INSERT INTO edges (source_id, target_id, relation, weight, metadata, created)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (source_id, target_id, relation)
         DO UPDATE SET weight = excluded.weight, metadata = excluded.metadata`,
      )
      .run(
        input.source_id,
        input.target_id,
        input.relation,
        weight,
        JSON.stringify(metadata),
        now,
      );

    // Fetch the actual row so we get the correct created timestamp on upsert
    const row = this.db
      .prepare(
        'SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?',
      )
      .get(input.source_id, input.target_id, input.relation) as EdgeRow;

    return this.rowToEdge(row);
  }

  getEdgesFrom(entityId: string, relation?: EdgeRelation): Edge[] {
    let sql = 'SELECT * FROM edges WHERE source_id = ?';
    const params: unknown[] = [entityId];

    if (relation !== undefined) {
      sql += ' AND relation = ?';
      params.push(relation);
    }

    const rows = this.db.prepare(sql).all(...params) as EdgeRow[];
    return rows.map(row => this.rowToEdge(row));
  }

  getEdgesTo(entityId: string, relation?: EdgeRelation): Edge[] {
    let sql = 'SELECT * FROM edges WHERE target_id = ?';
    const params: unknown[] = [entityId];

    if (relation !== undefined) {
      sql += ' AND relation = ?';
      params.push(relation);
    }

    const rows = this.db.prepare(sql).all(...params) as EdgeRow[];
    return rows.map(row => this.rowToEdge(row));
  }

  deleteEdge(sourceId: string, targetId: string, relation: EdgeRelation): void {
    this.db
      .prepare('DELETE FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?')
      .run(sourceId, targetId, relation);
  }

  incrementEdgeWeight(
    sourceId: string,
    targetId: string,
    relation: EdgeRelation,
    delta: number,
  ): void {
    this.db
      .prepare(
        `UPDATE edges
         SET weight = MIN(1.0, weight + ?)
         WHERE source_id = ? AND target_id = ? AND relation = ?`,
      )
      .run(delta, sourceId, targetId, relation);
  }

  // ---------------------------------------------------------------------------
  // Alias management
  // ---------------------------------------------------------------------------

  addAlias(entityId: string, alias: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO entity_aliases (entity_id, alias) VALUES (?, ?)')
      .run(entityId, alias.toLowerCase());
  }

  getAliases(entityId: string): string[] {
    const rows = this.db
      .prepare('SELECT alias FROM entity_aliases WHERE entity_id = ?')
      .all(entityId) as { alias: string }[];
    return rows.map(r => r.alias);
  }

  findByAlias(alias: string): Entity | null {
    const normalized = alias.toLowerCase();
    const row = this.db
      .prepare(
        `SELECT e.* FROM entities e
         JOIN entity_aliases a ON a.entity_id = e.id
         WHERE a.alias = ?`,
      )
      .get(normalized) as EntityRow | undefined;

    return row ? this.rowToEntity(row) : null;
  }

  // ---------------------------------------------------------------------------
  // Graph traversal
  // ---------------------------------------------------------------------------

  /**
   * BFS shortest path treating edges as undirected.
   * Returns Infinity if unreachable within maxHops.
   */
  distance(fromId: string, toId: string, maxHops = 4): number {
    if (fromId === toId) return 0;

    const visited = new Set<string>([fromId]);
    const queue: string[] = [fromId];
    let hops = 0;

    while (queue.length > 0 && hops < maxHops) {
      hops++;
      const levelSize = queue.length;
      for (let i = 0; i < levelSize; i++) {
        const current = queue.shift()!;
        for (const neighbor of this.getNeighborIds(current)) {
          if (neighbor === toId) return hops;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    return Infinity;
  }

  /**
   * Returns all entities within N hops, excluding self.
   */
  neighborhood(entityId: string, maxHops: number): Entity[] {
    const visited = new Set<string>([entityId]);
    const queue: string[] = [entityId];
    let hops = 0;

    while (queue.length > 0 && hops < maxHops) {
      hops++;
      const levelSize = queue.length;
      for (let i = 0; i < levelSize; i++) {
        const current = queue.shift()!;
        for (const neighbor of this.getNeighborIds(current)) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }

    visited.delete(entityId);
    const result: Entity[] = [];
    for (const id of visited) {
      const entity = this.getEntity(id);
      if (entity) result.push(entity);
    }
    return result;
  }

  /**
   * Returns 1 / (1 + distance). Returns 0 for unreachable nodes.
   */
  proximity(fromId: string, toId: string, maxHops = 4): number {
    const d = this.distance(fromId, toId, maxHops);
    if (d === Infinity) return 0;
    return 1 / (1 + d);
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getNeighborIds(entityId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT target_id AS id FROM edges WHERE source_id = ?
         UNION
         SELECT source_id AS id FROM edges WHERE target_id = ?`,
      )
      .all(entityId, entityId) as { id: string }[];
    return rows.map(r => r.id);
  }

  private rowToEntity(row: EntityRow): Entity {
    return {
      id: row.id,
      type: row.type as EntityType,
      name: row.name,
      metadata: JSON.parse(row.metadata || '{}') as Record<string, unknown>,
      created: row.created,
      updated: row.updated,
    };
  }

  private rowToEdge(row: EdgeRow): Edge {
    return {
      source_id: row.source_id,
      target_id: row.target_id,
      relation: row.relation as EdgeRelation,
      weight: row.weight,
      metadata: JSON.parse(row.metadata || '{}') as Record<string, unknown>,
      created: row.created,
    };
  }
}
