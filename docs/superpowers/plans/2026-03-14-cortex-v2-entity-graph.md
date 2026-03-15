# Cortex v2 — Pillar 1: Entity Graph Foundation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight SQLite-backed relationship graph to Cortex that models people, teams, departments, projects, systems, modules, and topics — the skeleton on which all future Cortex v2 pillars depend.

**Architecture:** A new `src/lib/cortex/graph/` module containing an `EntityGraph` class backed by `better-sqlite3` (already in package.json). The graph stores entities (nodes) and weighted edges (relationships) in three tables. Entity resolution provides alias-based and fuzzy lookup. BFS traversal computes graph distance for weight calculations. Auto-population seeds the graph from existing Spaces users and workspaces.

**Tech Stack:** TypeScript, better-sqlite3, vitest, Next.js API routes

**Spec:** `docs/superpowers/specs/2026-03-14-cortex-v2-design.md` — Pillar 1

---

## File Structure

```
src/lib/cortex/graph/
├── types.ts          — EntityType, EdgeRelation, Entity, Edge, interfaces
├── schema.ts         — SQLite table DDL, migrations, constants
├── entity-graph.ts   — EntityGraph class: entity CRUD, edge CRUD, traversal
├── resolver.ts       — Entity resolution: alias lookup, fuzzy match
└── auto-populate.ts  — Seed graph from Spaces users, workspaces (git-based seeding deferred to Pillar 5: Signal Ingestion)

tests/lib/cortex/graph/
├── entity-graph.test.ts    — Entity + edge CRUD tests
├── traversal.test.ts       — BFS distance, N-hop neighborhood tests
├── resolver.test.ts        — Alias + fuzzy resolution tests
└── auto-populate.test.ts   — Auto-population tests

src/app/api/cortex/graph/
├── entities/route.ts       — GET (list/search), POST (create)
├── entities/[id]/route.ts  — GET, PATCH, DELETE single entity
└── edges/route.ts          — GET (list), POST (create/upsert), DELETE (by query params)
```

---

## Chunk 1: Types, Schema, and Entity CRUD

### Task 1: Define graph types

**Files:**
- Create: `src/lib/cortex/graph/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/lib/cortex/graph/types.ts

export const ENTITY_TYPES = [
  'person', 'team', 'department', 'organization',
  'project', 'system', 'module', 'topic',
] as const;
export type EntityType = typeof ENTITY_TYPES[number];

export const EDGE_RELATIONS = [
  // Organizational
  'member_of', 'belongs_to', 'part_of',
  // Technical
  'works_on', 'expert_in', 'touches', 'owns', 'contains', 'depends_on', 'relates_to',
  // Knowledge
  'created_by', 'about', 'scoped_to', 'derived_from',
] as const;
export type EdgeRelation = typeof EDGE_RELATIONS[number];

export interface Entity {
  id: string;           // format: {type}-{slug}
  type: EntityType;
  name: string;
  metadata: Record<string, unknown>;
  created: string;      // ISO timestamp
  updated: string;      // ISO timestamp
}

export interface Edge {
  source_id: string;
  target_id: string;
  relation: EdgeRelation;
  weight: number;       // 0-1
  metadata: Record<string, unknown>;
  created: string;      // ISO timestamp
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/cortex/graph/types.ts
git commit -m "feat(cortex): add entity graph type definitions"
```

---

### Task 2: Create SQLite schema

**Files:**
- Create: `src/lib/cortex/graph/schema.ts`
- Test: `tests/lib/cortex/graph/entity-graph.test.ts`

- [ ] **Step 1: Write the failing test for schema initialization**

```typescript
// tests/lib/cortex/graph/entity-graph.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { initGraphSchema } from '@/lib/cortex/graph/schema';

describe('Graph Schema', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    dbPath = path.join(tmpDir, 'graph.db');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates all tables and indexes', () => {
    const db = new Database(dbPath);
    initGraphSchema(db);

    // Verify tables exist
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);

    expect(tableNames).toContain('entities');
    expect(tableNames).toContain('edges');
    expect(tableNames).toContain('entity_aliases');
    expect(tableNames).toContain('access_grants');
    expect(tableNames).toContain('gravity_state');

    // Verify indexes exist
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[];
    const indexNames = indexes.map(i => i.name);

    expect(indexNames).toContain('idx_entities_type');
    expect(indexNames).toContain('idx_edges_target');
    expect(indexNames).toContain('idx_aliases_alias');
    expect(indexNames).toContain('idx_grants_grantee');

    db.close();
  });

  it('is idempotent — calling twice does not error', () => {
    const db = new Database(dbPath);
    initGraphSchema(db);
    initGraphSchema(db); // second call should not throw
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/graph/entity-graph.test.ts`
Expected: FAIL — cannot find module `@/lib/cortex/graph/schema`

- [ ] **Step 3: Implement the schema module**

```typescript
// src/lib/cortex/graph/schema.ts
import type Database from 'better-sqlite3';

export function initGraphSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS edges (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      metadata TEXT DEFAULT '{}',
      created TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id, relation),
      FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entity_aliases (
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      PRIMARY KEY (entity_id, alias),
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS access_grants (
      knowledge_id TEXT NOT NULL,
      grantee_entity_id TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      created TEXT NOT NULL,
      PRIMARY KEY (knowledge_id, grantee_entity_id)
    );

    CREATE TABLE IF NOT EXISTS gravity_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id, relation);
    CREATE INDEX IF NOT EXISTS idx_aliases_alias ON entity_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_grants_grantee ON access_grants(grantee_entity_id);
  `);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/graph/entity-graph.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/graph/schema.ts tests/lib/cortex/graph/entity-graph.test.ts
git commit -m "feat(cortex): add SQLite schema for entity graph"
```

---

### Task 3: EntityGraph class — entity CRUD

**Files:**
- Create: `src/lib/cortex/graph/entity-graph.ts`
- Modify: `tests/lib/cortex/graph/entity-graph.test.ts`

- [ ] **Step 1: Write failing tests for entity CRUD**

Append to `tests/lib/cortex/graph/entity-graph.test.ts`:

```typescript
import { EntityGraph } from '@/lib/cortex/graph/entity-graph';
import type { Entity } from '@/lib/cortex/graph/types';

describe('EntityGraph — Entity CRUD', () => {
  let tmpDir: string;
  let graph: EntityGraph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates and retrieves an entity', () => {
    const entity = graph.createEntity({
      type: 'person',
      name: 'Alice Smith',
      metadata: { email: 'alice@acme.com', role: 'lead' },
    });

    expect(entity.id).toBe('person-alice-smith');
    expect(entity.type).toBe('person');
    expect(entity.name).toBe('Alice Smith');
    expect(entity.metadata).toEqual({ email: 'alice@acme.com', role: 'lead' });

    const fetched = graph.getEntity('person-alice-smith');
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('Alice Smith');
  });

  it('creates entity with explicit id', () => {
    const entity = graph.createEntity({
      id: 'person-custom-id',
      type: 'person',
      name: 'Bob',
    });
    expect(entity.id).toBe('person-custom-id');
  });

  it('updates an entity', () => {
    graph.createEntity({ type: 'team', name: 'Platform' });
    const updated = graph.updateEntity('team-platform', {
      name: 'Platform Engineering',
      metadata: { purpose: 'core infra' },
    });
    expect(updated!.name).toBe('Platform Engineering');
    expect(updated!.metadata).toEqual({ purpose: 'core infra' });
  });

  it('deletes an entity', () => {
    graph.createEntity({ type: 'topic', name: 'Auth' });
    expect(graph.getEntity('topic-auth')).not.toBeNull();
    graph.deleteEntity('topic-auth');
    expect(graph.getEntity('topic-auth')).toBeNull();
  });

  it('lists entities by type', () => {
    graph.createEntity({ type: 'person', name: 'Alice' });
    graph.createEntity({ type: 'person', name: 'Bob' });
    graph.createEntity({ type: 'team', name: 'Platform' });

    const people = graph.listEntities({ type: 'person' });
    expect(people).toHaveLength(2);

    const all = graph.listEntities();
    expect(all).toHaveLength(3);
  });

  it('returns null for non-existent entity', () => {
    expect(graph.getEntity('person-nobody')).toBeNull();
  });

  it('throws on duplicate entity id', () => {
    graph.createEntity({ type: 'person', name: 'Alice' });
    expect(() => graph.createEntity({ type: 'person', name: 'Alice' }))
      .toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/graph/entity-graph.test.ts`
Expected: FAIL — cannot find module `@/lib/cortex/graph/entity-graph`

- [ ] **Step 3: Implement EntityGraph — entity CRUD**

```typescript
// src/lib/cortex/graph/entity-graph.ts
import Database from 'better-sqlite3';
import { initGraphSchema } from './schema';
import { entityId, slugify } from './types';
import type { Entity, EntityType, Edge, EdgeRelation, EntityAlias } from './types';

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

export class EntityGraph {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    initGraphSchema(this.db);
  }

  // --- Entity CRUD ---

  createEntity(input: CreateEntityInput): Entity {
    const id = input.id ?? entityId(input.type, slugify(input.name));
    const now = new Date().toISOString();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.db.prepare(`
      INSERT INTO entities (id, type, name, metadata, created, updated)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.type, input.name, metadata, now, now);

    return { id, type: input.type, name: input.name, metadata: input.metadata ?? {}, created: now, updated: now };
  }

  getEntity(id: string): Entity | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToEntity(row);
  }

  updateEntity(id: string, updates: UpdateEntityInput): Entity | null {
    const existing = this.getEntity(id);
    if (!existing) return null;

    const now = new Date().toISOString();
    const name = updates.name ?? existing.name;
    const metadata = updates.metadata !== undefined
      ? JSON.stringify(updates.metadata)
      : JSON.stringify(existing.metadata);

    this.db.prepare(`
      UPDATE entities SET name = ?, metadata = ?, updated = ? WHERE id = ?
    `).run(name, metadata, now, id);

    return { ...existing, name, metadata: updates.metadata ?? existing.metadata, updated: now };
  }

  deleteEntity(id: string): void {
    this.db.prepare('DELETE FROM entities WHERE id = ?').run(id);
  }

  listEntities(filter: ListEntitiesFilter = {}): Entity[] {
    let sql = 'SELECT * FROM entities';
    const params: any[] = [];

    if (filter.type) {
      sql += ' WHERE type = ?';
      params.push(filter.type);
    }

    sql += ' ORDER BY name';

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(r => this.rowToEntity(r));
  }

  close(): void {
    this.db.close();
  }

  private rowToEntity(row: any): Entity {
    return {
      id: row.id,
      type: row.type as EntityType,
      name: row.name,
      metadata: JSON.parse(row.metadata || '{}'),
      created: row.created,
      updated: row.updated,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/graph/entity-graph.test.ts`
Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/graph/entity-graph.ts tests/lib/cortex/graph/entity-graph.test.ts
git commit -m "feat(cortex): add EntityGraph class with entity CRUD"
```

---

## Chunk 2: Edge CRUD and Graph Traversal

### Task 4: Edge CRUD methods

**Files:**
- Modify: `src/lib/cortex/graph/entity-graph.ts`
- Modify: `tests/lib/cortex/graph/entity-graph.test.ts`

- [ ] **Step 1: Write failing tests for edge CRUD**

Append to `tests/lib/cortex/graph/entity-graph.test.ts`:

```typescript
describe('EntityGraph — Edge CRUD', () => {
  let tmpDir: string;
  let graph: EntityGraph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));
    // Seed entities
    graph.createEntity({ type: 'person', name: 'Alice' });
    graph.createEntity({ type: 'person', name: 'Bob' });
    graph.createEntity({ type: 'team', name: 'Platform' });
    graph.createEntity({ type: 'system', name: 'Auth Service' });
    graph.createEntity({ type: 'topic', name: 'Authentication' });
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates an edge between entities', () => {
    const edge = graph.createEdge({
      source_id: 'person-alice',
      target_id: 'team-platform',
      relation: 'member_of',
      weight: 1.0,
      metadata: { role: 'lead' },
    });

    expect(edge.source_id).toBe('person-alice');
    expect(edge.target_id).toBe('team-platform');
    expect(edge.relation).toBe('member_of');
    expect(edge.weight).toBe(1.0);
  });

  it('upserts edge — updates weight on duplicate', () => {
    graph.createEdge({
      source_id: 'person-alice',
      target_id: 'topic-authentication',
      relation: 'expert_in',
      weight: 0.3,
    });
    graph.createEdge({
      source_id: 'person-alice',
      target_id: 'topic-authentication',
      relation: 'expert_in',
      weight: 0.8,
    });

    const edges = graph.getEdgesFrom('person-alice', 'expert_in');
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(0.8);
  });

  it('lists edges from an entity', () => {
    graph.createEdge({ source_id: 'person-alice', target_id: 'team-platform', relation: 'member_of' });
    graph.createEdge({ source_id: 'person-alice', target_id: 'topic-authentication', relation: 'expert_in' });
    graph.createEdge({ source_id: 'person-bob', target_id: 'team-platform', relation: 'member_of' });

    const aliceEdges = graph.getEdgesFrom('person-alice');
    expect(aliceEdges).toHaveLength(2);

    const platformMembers = graph.getEdgesTo('team-platform', 'member_of');
    expect(platformMembers).toHaveLength(2);
  });

  it('deletes an edge', () => {
    graph.createEdge({ source_id: 'person-alice', target_id: 'team-platform', relation: 'member_of' });
    expect(graph.getEdgesFrom('person-alice')).toHaveLength(1);

    graph.deleteEdge('person-alice', 'team-platform', 'member_of');
    expect(graph.getEdgesFrom('person-alice')).toHaveLength(0);
  });

  it('cascades entity delete to edges', () => {
    graph.createEdge({ source_id: 'person-alice', target_id: 'team-platform', relation: 'member_of' });
    graph.deleteEntity('person-alice');
    expect(graph.getEdgesTo('team-platform', 'member_of')).toHaveLength(0);
  });

  it('increments edge weight', () => {
    graph.createEdge({ source_id: 'person-alice', target_id: 'topic-authentication', relation: 'expert_in', weight: 0.5 });
    graph.incrementEdgeWeight('person-alice', 'topic-authentication', 'expert_in', 0.1);
    const edges = graph.getEdgesFrom('person-alice', 'expert_in');
    expect(edges[0].weight).toBeCloseTo(0.6);
  });

  it('caps edge weight at 1.0', () => {
    graph.createEdge({ source_id: 'person-alice', target_id: 'topic-authentication', relation: 'expert_in', weight: 0.95 });
    graph.incrementEdgeWeight('person-alice', 'topic-authentication', 'expert_in', 0.2);
    const edges = graph.getEdgesFrom('person-alice', 'expert_in');
    expect(edges[0].weight).toBe(1.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/graph/entity-graph.test.ts`
Expected: FAIL — `graph.createEdge is not a function`

- [ ] **Step 3: Add edge CRUD methods to EntityGraph**

Add these methods to the `EntityGraph` class in `src/lib/cortex/graph/entity-graph.ts`:

```typescript
interface CreateEdgeInput {
  source_id: string;
  target_id: string;
  relation: EdgeRelation;
  weight?: number;
  metadata?: Record<string, unknown>;
}

// Inside class EntityGraph:

createEdge(input: CreateEdgeInput): Edge {
  const now = new Date().toISOString();
  const weight = input.weight ?? 1.0;
  const metadata = JSON.stringify(input.metadata ?? {});

  this.db.prepare(`
    INSERT INTO edges (source_id, target_id, relation, weight, metadata, created)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, target_id, relation)
    DO UPDATE SET weight = excluded.weight, metadata = excluded.metadata
  `).run(input.source_id, input.target_id, input.relation, weight, metadata, now);

  return {
    source_id: input.source_id,
    target_id: input.target_id,
    relation: input.relation as EdgeRelation,
    weight,
    metadata: input.metadata ?? {},
    created: now,
  };
}

getEdgesFrom(entityId: string, relation?: EdgeRelation): Edge[] {
  let sql = 'SELECT * FROM edges WHERE source_id = ?';
  const params: any[] = [entityId];
  if (relation) {
    sql += ' AND relation = ?';
    params.push(relation);
  }
  return (this.db.prepare(sql).all(...params) as any[]).map(r => this.rowToEdge(r));
}

getEdgesTo(entityId: string, relation?: EdgeRelation): Edge[] {
  let sql = 'SELECT * FROM edges WHERE target_id = ?';
  const params: any[] = [entityId];
  if (relation) {
    sql += ' AND relation = ?';
    params.push(relation);
  }
  return (this.db.prepare(sql).all(...params) as any[]).map(r => this.rowToEdge(r));
}

deleteEdge(sourceId: string, targetId: string, relation: EdgeRelation): void {
  this.db.prepare(
    'DELETE FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?'
  ).run(sourceId, targetId, relation);
}

incrementEdgeWeight(sourceId: string, targetId: string, relation: EdgeRelation, delta: number): void {
  this.db.prepare(`
    UPDATE edges SET weight = MIN(1.0, weight + ?) WHERE source_id = ? AND target_id = ? AND relation = ?
  `).run(delta, sourceId, targetId, relation);
}

private rowToEdge(row: any): Edge {
  return {
    source_id: row.source_id,
    target_id: row.target_id,
    relation: row.relation as EdgeRelation,
    weight: row.weight,
    metadata: JSON.parse(row.metadata || '{}'),
    created: row.created,
  };
}
```

Also add the `CreateEdgeInput` interface import and export the interface types at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/graph/entity-graph.test.ts`
Expected: PASS (all 16 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/graph/entity-graph.ts tests/lib/cortex/graph/entity-graph.test.ts
git commit -m "feat(cortex): add edge CRUD with upsert and weight increment"
```

---

### Task 5: Alias management

**Files:**
- Modify: `src/lib/cortex/graph/entity-graph.ts`
- Modify: `tests/lib/cortex/graph/entity-graph.test.ts`

- [ ] **Step 1: Write failing tests for aliases**

Append to `tests/lib/cortex/graph/entity-graph.test.ts`:

```typescript
describe('EntityGraph — Aliases', () => {
  let tmpDir: string;
  let graph: EntityGraph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));
    graph.createEntity({ type: 'system', name: 'Auth Service' });
    graph.createEntity({ type: 'topic', name: 'Authentication' });
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds and retrieves aliases', () => {
    graph.addAlias('system-auth-service', 'auth');
    graph.addAlias('system-auth-service', 'auth-svc');
    graph.addAlias('system-auth-service', 'authentication service');

    const aliases = graph.getAliases('system-auth-service');
    expect(aliases).toHaveLength(3);
    expect(aliases).toContain('auth');
  });

  it('looks up entity by alias', () => {
    graph.addAlias('system-auth-service', 'auth');
    const entity = graph.findByAlias('auth');
    expect(entity).not.toBeNull();
    expect(entity!.id).toBe('system-auth-service');
  });

  it('returns null for unknown alias', () => {
    expect(graph.findByAlias('nonexistent')).toBeNull();
  });

  it('auto-creates aliases from entity name on create', () => {
    graph.createEntity({ type: 'system', name: 'API Gateway' });
    // Should auto-create aliases: "api gateway", "api-gateway"
    expect(graph.findByAlias('api gateway')).not.toBeNull();
    expect(graph.findByAlias('api-gateway')).not.toBeNull();
  });

  it('removes aliases when entity is deleted', () => {
    graph.addAlias('system-auth-service', 'auth');
    graph.deleteEntity('system-auth-service');
    expect(graph.findByAlias('auth')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/graph/entity-graph.test.ts`
Expected: FAIL — `graph.addAlias is not a function`

- [ ] **Step 3: Add alias methods to EntityGraph**

Add to `src/lib/cortex/graph/entity-graph.ts`:

```typescript
// Inside class EntityGraph:

addAlias(entityId: string, alias: string): void {
  const normalized = alias.toLowerCase().trim();
  this.db.prepare(
    'INSERT OR IGNORE INTO entity_aliases (entity_id, alias) VALUES (?, ?)'
  ).run(entityId, normalized);
}

getAliases(entityId: string): string[] {
  const rows = this.db.prepare(
    'SELECT alias FROM entity_aliases WHERE entity_id = ?'
  ).all(entityId) as { alias: string }[];
  return rows.map(r => r.alias);
}

findByAlias(alias: string): Entity | null {
  const normalized = alias.toLowerCase().trim();
  const row = this.db.prepare(
    'SELECT entity_id FROM entity_aliases WHERE alias = ? LIMIT 1'
  ).get(normalized) as { entity_id: string } | undefined;
  if (!row) return null;
  return this.getEntity(row.entity_id);
}
```

Also update `createEntity` to auto-add aliases:

```typescript
// After the INSERT in createEntity, add:
const nameLower = input.name.toLowerCase();
const nameSlug = slugify(input.name);
this.addAlias(id, nameLower);
if (nameSlug !== nameLower) {
  this.addAlias(id, nameSlug);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/graph/entity-graph.test.ts`
Expected: PASS (all 21 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/graph/entity-graph.ts tests/lib/cortex/graph/entity-graph.test.ts
git commit -m "feat(cortex): add alias management with auto-alias on entity creation"
```

---

### Task 6: Graph traversal — BFS distance and N-hop neighborhood

**Files:**
- Modify: `src/lib/cortex/graph/entity-graph.ts`
- Create: `tests/lib/cortex/graph/traversal.test.ts`

- [ ] **Step 1: Write failing tests for traversal**

```typescript
// tests/lib/cortex/graph/traversal.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EntityGraph } from '@/lib/cortex/graph/entity-graph';

describe('EntityGraph — Traversal', () => {
  let tmpDir: string;
  let graph: EntityGraph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));

    // Build a test graph:
    // Alice --member_of--> Platform --part_of--> Engineering --part_of--> Acme
    // Bob --member_of--> Platform
    // Alice --expert_in--> Auth (topic)
    // Platform --owns--> Auth Service (system)
    // Security --owns--> Auth Service
    graph.createEntity({ type: 'organization', name: 'Acme' });
    graph.createEntity({ type: 'department', name: 'Engineering' });
    graph.createEntity({ type: 'department', name: 'Security Dept' });
    graph.createEntity({ type: 'team', name: 'Platform' });
    graph.createEntity({ type: 'team', name: 'Security' });
    graph.createEntity({ type: 'person', name: 'Alice' });
    graph.createEntity({ type: 'person', name: 'Bob' });
    graph.createEntity({ type: 'topic', name: 'Auth' });
    graph.createEntity({ type: 'system', name: 'Auth Service' });

    graph.createEdge({ source_id: 'person-alice', target_id: 'team-platform', relation: 'member_of' });
    graph.createEdge({ source_id: 'person-bob', target_id: 'team-platform', relation: 'member_of' });
    graph.createEdge({ source_id: 'team-platform', target_id: 'department-engineering', relation: 'part_of' });
    graph.createEdge({ source_id: 'team-security', target_id: 'department-security-dept', relation: 'part_of' });
    graph.createEdge({ source_id: 'department-engineering', target_id: 'organization-acme', relation: 'part_of' });
    graph.createEdge({ source_id: 'department-security-dept', target_id: 'organization-acme', relation: 'part_of' });
    graph.createEdge({ source_id: 'person-alice', target_id: 'topic-auth', relation: 'expert_in' });
    graph.createEdge({ source_id: 'team-platform', target_id: 'system-auth-service', relation: 'owns' });
    graph.createEdge({ source_id: 'team-security', target_id: 'system-auth-service', relation: 'owns' });
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('computes distance 0 to self', () => {
    expect(graph.distance('person-alice', 'person-alice')).toBe(0);
  });

  it('computes distance 1 for direct neighbors', () => {
    expect(graph.distance('person-alice', 'team-platform')).toBe(1);
    expect(graph.distance('person-alice', 'topic-auth')).toBe(1);
  });

  it('computes distance 2 for two-hop paths', () => {
    // Alice -> Platform -> Engineering
    expect(graph.distance('person-alice', 'department-engineering')).toBe(2);
    // Alice -> Platform -> Bob (via Platform)
    expect(graph.distance('person-alice', 'person-bob')).toBe(2);
  });

  it('computes distance 3 for three-hop paths', () => {
    // Alice -> Platform -> Engineering -> Acme
    expect(graph.distance('person-alice', 'organization-acme')).toBe(3);
  });

  it('traverses edges bidirectionally', () => {
    // Bob -> Platform (outgoing), Platform -> Alice (incoming to Platform)
    expect(graph.distance('person-bob', 'person-alice')).toBe(2);
  });

  it('returns Infinity for unreachable entities', () => {
    graph.createEntity({ type: 'topic', name: 'Isolated' });
    expect(graph.distance('person-alice', 'topic-isolated')).toBe(Infinity);
  });

  it('respects maxHops limit', () => {
    // Alice -> Platform -> Engineering -> Acme is 3 hops
    expect(graph.distance('person-alice', 'organization-acme', 2)).toBe(Infinity);
    expect(graph.distance('person-alice', 'organization-acme', 3)).toBe(3);
  });

  it('returns entities within N hops', () => {
    const nearby = graph.neighborhood('person-alice', 1);
    const ids = nearby.map(e => e.id);
    expect(ids).toContain('team-platform');
    expect(ids).toContain('topic-auth');
    expect(ids).not.toContain('department-engineering');
    expect(ids).not.toContain('person-alice'); // self excluded
  });

  it('returns entities within 2 hops', () => {
    const nearby = graph.neighborhood('person-alice', 2);
    const ids = nearby.map(e => e.id);
    expect(ids).toContain('team-platform');
    expect(ids).toContain('department-engineering');
    expect(ids).toContain('person-bob');
    expect(ids).toContain('system-auth-service');
  });

  it('computes graph proximity score', () => {
    // Create an isolated entity within this test's scope
    graph.createEntity({ type: 'topic', name: 'Orphaned' });

    // proximity = 1 / (1 + distance)
    expect(graph.proximity('person-alice', 'person-alice')).toBe(1.0);    // distance 0
    expect(graph.proximity('person-alice', 'team-platform')).toBe(0.5);   // distance 1
    expect(graph.proximity('person-alice', 'department-engineering')).toBeCloseTo(0.333); // distance 2
    expect(graph.proximity('person-alice', 'topic-orphaned')).toBe(0);    // unreachable (no edges)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/graph/traversal.test.ts`
Expected: FAIL — `graph.distance is not a function`

- [ ] **Step 3: Implement traversal methods**

Add to `src/lib/cortex/graph/entity-graph.ts`:

```typescript
// Inside class EntityGraph:

/**
 * BFS shortest-path distance between two entities.
 * Edges are traversed bidirectionally (undirected graph for distance).
 * Returns Infinity if no path exists within maxHops.
 */
distance(fromId: string, toId: string, maxHops: number = 4): number {
  if (fromId === toId) return 0;

  const visited = new Set<string>([fromId]);
  let frontier = [fromId];
  let depth = 0;

  while (frontier.length > 0 && depth < maxHops) {
    depth++;
    const nextFrontier: string[] = [];

    for (const nodeId of frontier) {
      const neighbors = this.getNeighborIds(nodeId);
      for (const neighbor of neighbors) {
        if (neighbor === toId) return depth;
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }

    frontier = nextFrontier;
  }

  return Infinity;
}

/**
 * All entities within N hops (excluding self).
 */
neighborhood(entityId: string, maxHops: number): Entity[] {
  const visited = new Set<string>([entityId]);
  let frontier = [entityId];

  for (let depth = 0; depth < maxHops; depth++) {
    const nextFrontier: string[] = [];
    for (const nodeId of frontier) {
      for (const neighbor of this.getNeighborIds(nodeId)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextFrontier.push(neighbor);
        }
      }
    }
    frontier = nextFrontier;
  }

  visited.delete(entityId); // exclude self
  return [...visited]
    .map(id => this.getEntity(id))
    .filter((e): e is Entity => e !== null);
}

/**
 * Graph proximity: 1 / (1 + distance). Returns 0 for unreachable.
 */
proximity(fromId: string, toId: string, maxHops: number = 4): number {
  const d = this.distance(fromId, toId, maxHops);
  if (d === Infinity) return 0;
  return 1 / (1 + d);
}

/**
 * Get all neighbor IDs (both directions — edges are treated as undirected for traversal).
 * Single UNION query for efficiency during BFS.
 */
private getNeighborIds(entityId: string): string[] {
  const rows = this.db.prepare(`
    SELECT target_id AS id FROM edges WHERE source_id = ?
    UNION
    SELECT source_id AS id FROM edges WHERE target_id = ?
  `).all(entityId, entityId) as { id: string }[];

  return rows.map(r => r.id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/graph/traversal.test.ts`
Expected: PASS (all 10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/graph/entity-graph.ts tests/lib/cortex/graph/traversal.test.ts
git commit -m "feat(cortex): add BFS distance, neighborhood, and proximity to entity graph"
```

---

## Chunk 3: Entity Resolution and Auto-Population

### Task 7: Entity resolver — alias + fuzzy lookup

**Files:**
- Create: `src/lib/cortex/graph/resolver.ts`
- Create: `tests/lib/cortex/graph/resolver.test.ts`

- [ ] **Step 1: Write failing tests for resolver**

```typescript
// tests/lib/cortex/graph/resolver.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EntityGraph } from '@/lib/cortex/graph/entity-graph';
import { EntityResolver } from '@/lib/cortex/graph/resolver';

describe('EntityResolver', () => {
  let tmpDir: string;
  let graph: EntityGraph;
  let resolver: EntityResolver;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));
    resolver = new EntityResolver(graph);

    graph.createEntity({ type: 'system', name: 'Auth Service' });
    graph.createEntity({ type: 'system', name: 'API Gateway' });
    graph.createEntity({ type: 'topic', name: 'Authentication' });
    graph.createEntity({ type: 'topic', name: 'Performance' });
    graph.createEntity({ type: 'person', name: 'Alice Smith' });
    graph.addAlias('system-auth-service', 'auth');
    graph.addAlias('system-auth-service', 'auth-svc');
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves exact alias match', () => {
    const result = resolver.resolve('auth');
    expect(result).not.toBeNull();
    expect(result!.entity.id).toBe('system-auth-service');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result!.method).toBe('alias');
  });

  it('resolves fuzzy alias match', () => {
    const result = resolver.resolve('auth servce'); // typo
    expect(result).not.toBeNull();
    expect(result!.entity.id).toBe('system-auth-service');
    expect(result!.method).toBe('fuzzy');
    expect(result!.confidence).toBeLessThan(0.95); // lower than exact
  });

  it('returns null for unresolvable text', () => {
    expect(resolver.resolve('completely unknown xyz')).toBeNull();
  });

  it('extracts multiple entities from text', () => {
    const entities = resolver.extractEntities('fix the auth service performance issue');
    const ids = entities.map(e => e.entity.id);
    expect(ids).toContain('system-auth-service');
    expect(ids).toContain('topic-performance');
  });

  it('prefers exact alias over fuzzy match', () => {
    const result = resolver.resolve('auth');
    expect(result!.method).toBe('alias');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/graph/resolver.test.ts`
Expected: FAIL — cannot find module `@/lib/cortex/graph/resolver`

- [ ] **Step 3: Implement the resolver**

```typescript
// src/lib/cortex/graph/resolver.ts
import type { EntityGraph } from './entity-graph';
import type { Entity } from './types';

export interface ResolvedEntity {
  entity: Entity;
  confidence: number;
  method: 'alias' | 'fuzzy' | 'name';
}

export class EntityResolver {
  constructor(private graph: EntityGraph) {}

  /**
   * Resolve a text fragment to an entity.
   * Tries: 1) exact alias  2) entity name  3) fuzzy match (Levenshtein ≤ 2)
   */
  resolve(text: string): ResolvedEntity | null {
    const normalized = text.toLowerCase().trim();

    // 1. Exact alias match
    const byAlias = this.graph.findByAlias(normalized);
    if (byAlias) {
      return { entity: byAlias, confidence: 0.95, method: 'alias' };
    }

    // 2. Exact name match (case-insensitive via alias auto-creation)
    // Already covered by alias lookup since createEntity auto-adds name as alias

    // 3. Fuzzy match — scan all aliases for Levenshtein ≤ 2
    const allEntities = this.graph.listEntities();
    let bestMatch: ResolvedEntity | null = null;
    let bestDistance = 3; // max acceptable

    for (const entity of allEntities) {
      const aliases = this.graph.getAliases(entity.id);
      const candidates = [entity.name.toLowerCase(), ...aliases];

      for (const candidate of candidates) {
        const dist = levenshtein(normalized, candidate);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestMatch = {
            entity,
            confidence: Math.max(0.5, 0.9 - dist * 0.15),
            method: 'fuzzy',
          };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Extract all entity references from a text string.
   * Scans for known entity names and aliases within the text.
   */
  extractEntities(text: string): ResolvedEntity[] {
    const normalized = text.toLowerCase();
    const results: ResolvedEntity[] = [];
    const seen = new Set<string>();

    const allEntities = this.graph.listEntities();

    for (const entity of allEntities) {
      if (seen.has(entity.id)) continue;

      const aliases = [entity.name.toLowerCase(), ...this.graph.getAliases(entity.id)];

      for (const alias of aliases) {
        if (alias.length < 3) continue; // skip very short aliases to avoid false matches
        if (normalized.includes(alias)) {
          results.push({ entity, confidence: 0.85, method: 'alias' });
          seen.add(entity.id);
          break;
        }
      }
    }

    return results;
  }
}

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[a.length][b.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/graph/resolver.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/graph/resolver.ts tests/lib/cortex/graph/resolver.test.ts
git commit -m "feat(cortex): add entity resolver with alias and fuzzy matching"
```

---

### Task 8: Auto-population from Spaces data

> **Scope note:** This task seeds the graph from declarative configuration (org, users, teams, projects). Git-based seeding (WORKS_ON, TOUCHES, EXPERT_IN edges from commit history and blame; Systems/Modules from directory structure; Topics from file paths) is deferred to **Pillar 5: Observable Signal Ingestion** where the Git History adapter will populate these automatically.

**Files:**
- Create: `src/lib/cortex/graph/auto-populate.ts`
- Create: `tests/lib/cortex/graph/auto-populate.test.ts`

- [ ] **Step 1: Write failing tests for auto-population**

```typescript
// tests/lib/cortex/graph/auto-populate.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EntityGraph } from '@/lib/cortex/graph/entity-graph';
import { autoPopulate } from '@/lib/cortex/graph/auto-populate';

// Mock the user/workspace data sources
vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => 'test-user',
  getAuthUser: () => 'test-user',
  withUser: (_user: string, fn: () => any) => fn(),
}));

describe('autoPopulate', () => {
  let tmpDir: string;
  let graph: EntityGraph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates default organization entity', () => {
    autoPopulate(graph, { orgName: 'Acme Corp' });

    const org = graph.getEntity('organization-acme-corp');
    expect(org).not.toBeNull();
    expect(org!.name).toBe('Acme Corp');
    expect(org!.type).toBe('organization');
  });

  it('creates person entities from user list', () => {
    autoPopulate(graph, {
      orgName: 'Acme',
      users: [
        { name: 'Alice Smith', email: 'alice@acme.com', role: 'lead' },
        { name: 'Bob Jones', email: 'bob@acme.com', role: 'member' },
      ],
    });

    const alice = graph.getEntity('person-alice-smith');
    expect(alice).not.toBeNull();
    expect(alice!.metadata).toEqual({ email: 'alice@acme.com', role: 'lead' });

    const bob = graph.getEntity('person-bob-jones');
    expect(bob).not.toBeNull();
  });

  it('creates team entities and membership edges', () => {
    autoPopulate(graph, {
      orgName: 'Acme',
      teams: [
        { name: 'Platform', department: 'Engineering', members: ['Alice Smith'] },
      ],
      users: [{ name: 'Alice Smith', email: 'alice@acme.com' }],
    });

    const team = graph.getEntity('team-platform');
    expect(team).not.toBeNull();

    const dept = graph.getEntity('department-engineering');
    expect(dept).not.toBeNull();

    // Check edges
    const memberEdges = graph.getEdgesTo('team-platform', 'member_of');
    expect(memberEdges).toHaveLength(1);
    expect(memberEdges[0].source_id).toBe('person-alice-smith');

    const partOfEdges = graph.getEdgesFrom('team-platform', 'part_of');
    expect(partOfEdges).toHaveLength(1);
    expect(partOfEdges[0].target_id).toBe('department-engineering');
  });

  it('is idempotent — running twice creates no duplicates', () => {
    const config = { orgName: 'Acme', users: [{ name: 'Alice', email: 'a@a.com' }] };
    autoPopulate(graph, config);
    autoPopulate(graph, config); // second run

    const people = graph.listEntities({ type: 'person' });
    expect(people).toHaveLength(1);
  });

  it('creates project entities from workspace data', () => {
    autoPopulate(graph, {
      orgName: 'Acme',
      projects: [
        { name: 'Spaces', team: 'Platform', repoUrl: 'https://github.com/org/spaces' },
      ],
      teams: [{ name: 'Platform', department: 'Engineering' }],
    });

    const project = graph.getEntity('project-spaces');
    expect(project).not.toBeNull();

    const ownsEdges = graph.getEdgesTo('project-spaces', 'owns');
    expect(ownsEdges).toHaveLength(1);
    expect(ownsEdges[0].source_id).toBe('team-platform');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/graph/auto-populate.test.ts`
Expected: FAIL — cannot find module `@/lib/cortex/graph/auto-populate`

- [ ] **Step 3: Implement auto-populate**

```typescript
// src/lib/cortex/graph/auto-populate.ts
import type { EntityGraph } from './entity-graph';
import { slugify, entityId } from './types';

interface UserInput {
  name: string;
  email?: string;
  role?: string;
}

interface TeamInput {
  name: string;
  department?: string;
  members?: string[];  // person names
}

interface ProjectInput {
  name: string;
  team?: string;       // team name
  repoUrl?: string;
}

export interface AutoPopulateConfig {
  orgName: string;
  users?: UserInput[];
  teams?: TeamInput[];
  projects?: ProjectInput[];
}

export function autoPopulate(graph: EntityGraph, config: AutoPopulateConfig): void {
  const orgId = entityId('organization', slugify(config.orgName));

  // 1. Organization (idempotent)
  if (!graph.getEntity(orgId)) {
    graph.createEntity({ type: 'organization', name: config.orgName });
  }

  // Track created departments for dedup
  const deptIds = new Set<string>();

  // 2. Teams + departments
  if (config.teams) {
    for (const team of config.teams) {
      const teamId = entityId('team', slugify(team.name));

      if (!graph.getEntity(teamId)) {
        graph.createEntity({ type: 'team', name: team.name });
      }

      // Department
      if (team.department) {
        const deptId = entityId('department', slugify(team.department));
        if (!deptIds.has(deptId) && !graph.getEntity(deptId)) {
          graph.createEntity({ type: 'department', name: team.department });
          graph.createEdge({ source_id: deptId, target_id: orgId, relation: 'part_of' });
        }
        deptIds.add(deptId);
        graph.createEdge({ source_id: teamId, target_id: deptId, relation: 'part_of' });
      }
    }
  }

  // 3. Users
  if (config.users) {
    for (const user of config.users) {
      const personId = entityId('person', slugify(user.name));

      if (!graph.getEntity(personId)) {
        graph.createEntity({
          type: 'person',
          name: user.name,
          metadata: {
            ...(user.email && { email: user.email }),
            ...(user.role && { role: user.role }),
          },
        });
      }

      // Link to teams
      if (config.teams) {
        for (const team of config.teams) {
          if (team.members?.includes(user.name)) {
            const teamId = entityId('team', slugify(team.name));
            graph.createEdge({
              source_id: personId,
              target_id: teamId,
              relation: 'member_of',
              metadata: { role: user.role ?? 'member' },
            });
          }
        }
      }
    }
  }

  // 4. Projects
  if (config.projects) {
    for (const project of config.projects) {
      const projectId = entityId('project', slugify(project.name));

      if (!graph.getEntity(projectId)) {
        graph.createEntity({
          type: 'project',
          name: project.name,
          metadata: {
            ...(project.repoUrl && { repo_url: project.repoUrl }),
          },
        });
      }

      // Link to team
      if (project.team) {
        const teamId = entityId('team', slugify(project.team));
        graph.createEdge({ source_id: teamId, target_id: projectId, relation: 'owns' });
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/graph/auto-populate.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/graph/auto-populate.ts tests/lib/cortex/graph/auto-populate.test.ts
git commit -m "feat(cortex): add auto-populate for seeding entity graph from org data"
```

---

## Chunk 4: API Routes and CortexInstance Integration

### Task 9: Graph API — entity endpoints

**Files:**
- Create: `src/app/api/cortex/graph/entities/route.ts`
- Create: `src/app/api/cortex/graph/entities/[id]/route.ts`

- [ ] **Step 1: Create entity list/create endpoint**

```typescript
// src/app/api/cortex/graph/entities/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) return NextResponse.json({ entities: [] });

    const url = new URL(request.url);
    const type = url.searchParams.get('type') || undefined;
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);

    const entities = cortex.graph.listEntities({
      type: type as any,
      limit,
    });

    return NextResponse.json({ entities });
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) {
      return NextResponse.json({ error: 'Graph not initialized' }, { status: 500 });
    }

    const body = await request.json();
    const { type, name, id, metadata } = body;

    if (!type || !name) {
      return NextResponse.json({ error: 'type and name are required' }, { status: 400 });
    }

    const { isValidEntityType } = await import('@/lib/cortex/graph/types');
    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: `Invalid entity type: ${type}` }, { status: 400 });
    }

    try {
      const entity = cortex.graph.createEntity({ id, type, name, metadata });
      return NextResponse.json({ entity }, { status: 201 });
    } catch (err: any) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
  });
}
```

- [ ] **Step 2: Create single-entity endpoint**

```typescript
// src/app/api/cortex/graph/entities/[id]/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) return NextResponse.json({ error: 'Graph not initialized' }, { status: 500 });

    const entity = cortex.graph.getEntity(id);
    if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ entity });
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) return NextResponse.json({ error: 'Graph not initialized' }, { status: 500 });

    const body = await request.json();
    const updated = cortex.graph.updateEntity(id, body);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ entity: updated });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) return NextResponse.json({ error: 'Graph not initialized' }, { status: 500 });

    cortex.graph.deleteEntity(id);
    return NextResponse.json({ deleted: true });
  });
}

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cortex/graph/
git commit -m "feat(cortex): add API routes for entity CRUD"
```

---

### Task 10: Graph API — edge endpoints

**Files:**
- Create: `src/app/api/cortex/graph/edges/route.ts`

- [ ] **Step 1: Create edge list/create endpoint**

```typescript
// src/app/api/cortex/graph/edges/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) return NextResponse.json({ edges: [] });

    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const relation = url.searchParams.get('relation') || undefined;

    let edges;
    if (from) {
      edges = cortex.graph.getEdgesFrom(from, relation as any);
    } else if (to) {
      edges = cortex.graph.getEdgesTo(to, relation as any);
    } else {
      return NextResponse.json({ error: 'Provide from or to parameter' }, { status: 400 });
    }

    return NextResponse.json({ edges });
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) {
      return NextResponse.json({ error: 'Graph not initialized' }, { status: 500 });
    }

    const body = await request.json();
    const { source_id, target_id, relation, weight, metadata } = body;

    if (!source_id || !target_id || !relation) {
      return NextResponse.json(
        { error: 'source_id, target_id, and relation are required' },
        { status: 400 },
      );
    }

    const edge = cortex.graph.createEdge({ source_id, target_id, relation, weight, metadata });
    return NextResponse.json({ edge }, { status: 201 });
  });
}

export async function DELETE(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) return NextResponse.json({ error: 'Graph not initialized' }, { status: 500 });

    const url = new URL(request.url);
    const source_id = url.searchParams.get('source_id');
    const target_id = url.searchParams.get('target_id');
    const relation = url.searchParams.get('relation');

    if (!source_id || !target_id || !relation) {
      return NextResponse.json(
        { error: 'source_id, target_id, and relation query params are required' },
        { status: 400 },
      );
    }

    cortex.graph.deleteEdge(source_id, target_id, relation as any);
    return NextResponse.json({ deleted: true });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cortex/graph/edges/route.ts
git commit -m "feat(cortex): add API routes for edge CRUD"
```

---

### Task 11: Integrate EntityGraph into CortexInstance

**Files:**
- Modify: `src/lib/cortex/index.ts`

- [ ] **Step 1: Read the current index.ts**

Read `src/lib/cortex/index.ts` to understand the current CortexInstance pattern and initialization flow.

- [ ] **Step 2: Add graph to CortexInstance**

Add the `graph` property and initialization:

1. Import EntityGraph:
```typescript
import { EntityGraph } from './graph/entity-graph';
```

2. Add to CortexInstance interface:
```typescript
export interface CortexInstance {
  config: CortexConfig;
  store: CortexStore;
  search: CortexSearch;
  pipeline: IngestionPipeline;
  embedding: EmbeddingProvider;
  graph: EntityGraph;  // NEW
  sync?: FederationSync;
  distillQueue?: DistillationQueue;
  distillScheduler?: DistillationScheduler;
}
```

3. In `getCortex()`, after store initialization and before `_instance` assignment:
```typescript
// Initialize entity graph (SQLite)
const graphPath = path.join(cortexDir, 'graph.db');
const graph = new EntityGraph(graphPath);
```

4. Add `graph` to the instance object.

5. In `resetCortex()`, add cleanup:
```typescript
if (_instance) {
  _instance.graph.close();
  // ... existing cleanup
}
```

- [ ] **Step 3: Run existing tests to verify no regressions**

Run: `npx vitest run tests/lib/cortex/`
Expected: All existing tests pass. May have 2 pre-existing failures in config.test.ts and chunker.test.ts (known issues, unrelated).

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/index.ts
git commit -m "feat(cortex): integrate EntityGraph into CortexInstance lifecycle"
```

---

### Task 12: Module index and barrel export

**Files:**
- Create: `src/lib/cortex/graph/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// src/lib/cortex/graph/index.ts
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
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run tests/lib/cortex/graph/`
Expected: PASS — all graph tests pass (30+ tests across 4 files)

- [ ] **Step 3: Commit**

```bash
git add src/lib/cortex/graph/index.ts
git commit -m "feat(cortex): add graph module barrel export"
```

---

## Summary

| Task | Component | Tests | Status |
|------|-----------|-------|--------|
| 1 | Graph types | — | |
| 2 | SQLite schema | 2 | |
| 3 | Entity CRUD | 7 | |
| 4 | Edge CRUD | 7 | |
| 5 | Alias management | 5 | |
| 6 | BFS traversal | 10 | |
| 7 | Entity resolver | 5 | |
| 8 | Auto-populate | 5 | |
| 9 | Entity API routes | — | |
| 10 | Edge API routes | — | |
| 11 | CortexInstance integration | regression | |
| 12 | Barrel export | regression | |

**Total: 12 tasks, 41 tests, 4 chunks**

After this plan is complete, the entity graph foundation is in place for Pillar 2 (Knowledge Unit Evolution) to build on — linking knowledge units to graph entities and replacing the flat `layer` field with graph-aware `scope`.
