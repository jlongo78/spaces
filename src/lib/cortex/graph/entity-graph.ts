import Database from 'better-sqlite3';
import { initGraphSchema } from './schema';
import { entityId, slugify } from './types';
import type { Entity, EntityType } from './types';

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

export class EntityGraph {
  private db: InstanceType<typeof Database>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    initGraphSchema(this.db);
  }

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

  close(): void {
    this.db.close();
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
}
