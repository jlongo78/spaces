import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { initGraphSchema } from '@/lib/cortex/graph/schema';
import { EntityGraph } from '@/lib/cortex/graph/entity-graph';

// ---------------------------------------------------------------------------
// Task 2: Schema tests
// ---------------------------------------------------------------------------

describe('initGraphSchema', () => {
  let tmpDir: string;
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    db = new Database(path.join(tmpDir, 'graph.db'));
    initGraphSchema(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates all tables and indexes', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(tables).toContain('entities');
    expect(tables).toContain('edges');
    expect(tables).toContain('entity_aliases');
    expect(tables).toContain('access_grants');
    expect(tables).toContain('gravity_state');

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    expect(indexes).toContain('idx_entities_type');
    expect(indexes).toContain('idx_edges_target');
    expect(indexes).toContain('idx_aliases_alias');
    expect(indexes).toContain('idx_grants_grantee');
  });

  it('is idempotent — calling twice does not error', () => {
    expect(() => initGraphSchema(db)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Task 3: EntityGraph CRUD tests
// ---------------------------------------------------------------------------

describe('EntityGraph', () => {
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
    const entity = graph.createEntity({ type: 'person', name: 'Alice Smith' });

    expect(entity.id).toBe('person-alice-smith');
    expect(entity.type).toBe('person');
    expect(entity.name).toBe('Alice Smith');
    expect(entity.metadata).toEqual({});
    expect(entity.created).toBeTruthy();
    expect(entity.updated).toBeTruthy();

    const retrieved = graph.getEntity('person-alice-smith');
    expect(retrieved).toEqual(entity);
  });

  it('creates entity with explicit id', () => {
    const entity = graph.createEntity({
      id: 'person-custom-id',
      type: 'person',
      name: 'Bob Jones',
    });
    expect(entity.id).toBe('person-custom-id');
    expect(graph.getEntity('person-custom-id')).toEqual(entity);
  });

  it('updates an entity', () => {
    graph.createEntity({ type: 'person', name: 'Charlie' });
    const updated = graph.updateEntity('person-charlie', {
      name: 'Charlie Updated',
      metadata: { role: 'engineer' },
    });

    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Charlie Updated');
    expect(updated!.metadata).toEqual({ role: 'engineer' });
    expect(updated!.updated).not.toBe(updated!.created);
  });

  it('deletes an entity', () => {
    graph.createEntity({ type: 'person', name: 'Dave' });
    expect(graph.getEntity('person-dave')).not.toBeNull();

    graph.deleteEntity('person-dave');
    expect(graph.getEntity('person-dave')).toBeNull();
  });

  it('lists entities by type', () => {
    graph.createEntity({ type: 'person', name: 'Eve' });
    graph.createEntity({ type: 'person', name: 'Frank' });
    graph.createEntity({ type: 'team', name: 'Alpha Team' });

    const people = graph.listEntities({ type: 'person' });
    expect(people).toHaveLength(2);
    expect(people.every(e => e.type === 'person')).toBe(true);

    const all = graph.listEntities();
    expect(all).toHaveLength(3);
  });

  it('returns null for non-existent entity', () => {
    expect(graph.getEntity('person-does-not-exist')).toBeNull();
  });

  it('throws on duplicate entity id', () => {
    graph.createEntity({ type: 'person', name: 'Grace' });
    expect(() => graph.createEntity({ type: 'person', name: 'Grace' })).toThrow();
  });
});
