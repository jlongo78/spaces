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

// ---------------------------------------------------------------------------
// Task 4: EntityGraph — Edge CRUD
// ---------------------------------------------------------------------------

describe('EntityGraph — Edge CRUD', () => {
  let tmpDir: string;
  let graph: EntityGraph;

  // Seed entity ids for convenience
  const ALICE = 'person-alice';
  const BOB = 'person-bob';
  const PLATFORM = 'team-platform';
  const AUTH_SERVICE = 'system-auth-service';
  const AUTH_TOPIC = 'topic-authentication';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));

    graph.createEntity({ id: ALICE, type: 'person', name: 'Alice' });
    graph.createEntity({ id: BOB, type: 'person', name: 'Bob' });
    graph.createEntity({ id: PLATFORM, type: 'team', name: 'Platform' });
    graph.createEntity({ id: AUTH_SERVICE, type: 'system', name: 'Auth Service' });
    graph.createEntity({ id: AUTH_TOPIC, type: 'topic', name: 'Authentication' });
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates an edge between entities', () => {
    const edge = graph.createEdge({
      source_id: ALICE,
      target_id: PLATFORM,
      relation: 'member_of',
    });

    expect(edge.source_id).toBe(ALICE);
    expect(edge.target_id).toBe(PLATFORM);
    expect(edge.relation).toBe('member_of');
    expect(edge.weight).toBe(1.0);
    expect(edge.metadata).toEqual({});
    expect(edge.created).toBeTruthy();
  });

  it('upserts edge — updates weight on duplicate', () => {
    graph.createEdge({ source_id: ALICE, target_id: AUTH_TOPIC, relation: 'expert_in', weight: 0.3 });
    graph.createEdge({ source_id: ALICE, target_id: AUTH_TOPIC, relation: 'expert_in', weight: 0.8 });

    const edges = graph.getEdgesFrom(ALICE, 'expert_in');
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(0.8);
  });

  it('lists edges from an entity', () => {
    graph.createEdge({ source_id: ALICE, target_id: PLATFORM, relation: 'member_of' });
    graph.createEdge({ source_id: ALICE, target_id: AUTH_TOPIC, relation: 'expert_in' });
    graph.createEdge({ source_id: BOB, target_id: PLATFORM, relation: 'member_of' });

    const aliceEdges = graph.getEdgesFrom(ALICE);
    expect(aliceEdges).toHaveLength(2);

    const platformIncoming = graph.getEdgesTo(PLATFORM, 'member_of');
    expect(platformIncoming).toHaveLength(2);
  });

  it('deletes an edge', () => {
    graph.createEdge({ source_id: ALICE, target_id: PLATFORM, relation: 'member_of' });
    graph.deleteEdge(ALICE, PLATFORM, 'member_of');

    const edges = graph.getEdgesFrom(ALICE, 'member_of');
    expect(edges).toHaveLength(0);
  });

  it('cascades entity delete to edges', () => {
    graph.createEdge({ source_id: ALICE, target_id: PLATFORM, relation: 'member_of' });
    graph.createEdge({ source_id: BOB, target_id: PLATFORM, relation: 'member_of' });

    graph.deleteEntity(ALICE);

    const platformIncoming = graph.getEdgesTo(PLATFORM, 'member_of');
    expect(platformIncoming).toHaveLength(1);
    expect(platformIncoming[0].source_id).toBe(BOB);
  });

  it('increments edge weight', () => {
    graph.createEdge({ source_id: ALICE, target_id: AUTH_TOPIC, relation: 'expert_in', weight: 0.5 });
    graph.incrementEdgeWeight(ALICE, AUTH_TOPIC, 'expert_in', 0.1);

    const edges = graph.getEdgesFrom(ALICE, 'expert_in');
    expect(edges[0].weight).toBeCloseTo(0.6);
  });

  it('caps edge weight at 1.0', () => {
    graph.createEdge({ source_id: ALICE, target_id: AUTH_TOPIC, relation: 'expert_in', weight: 0.95 });
    graph.incrementEdgeWeight(ALICE, AUTH_TOPIC, 'expert_in', 0.2);

    const edges = graph.getEdgesFrom(ALICE, 'expert_in');
    expect(edges[0].weight).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Task 5: EntityGraph — Aliases
// ---------------------------------------------------------------------------

describe('EntityGraph — Aliases', () => {
  let tmpDir: string;
  let graph: EntityGraph;

  const AUTH_SERVICE = 'system-auth-service';
  const AUTH_TOPIC = 'topic-authentication';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-graph-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));

    graph.createEntity({ id: AUTH_SERVICE, type: 'system', name: 'Auth Service' });
    graph.createEntity({ id: AUTH_TOPIC, type: 'topic', name: 'Authentication' });
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds and retrieves aliases', () => {
    graph.addAlias(AUTH_SERVICE, 'auth');
    graph.addAlias(AUTH_SERVICE, 'authentication service');
    graph.addAlias(AUTH_SERVICE, 'sso');

    const aliases = graph.getAliases(AUTH_SERVICE);
    expect(aliases).toContain('auth');
    expect(aliases).toContain('authentication service');
    expect(aliases).toContain('sso');
    // At minimum the 3 we added (auto-aliases may also be present)
    expect(aliases.length).toBeGreaterThanOrEqual(3);
  });

  it('looks up entity by alias', () => {
    graph.addAlias(AUTH_SERVICE, 'auth');

    const entity = graph.findByAlias('auth');
    expect(entity).not.toBeNull();
    expect(entity!.id).toBe(AUTH_SERVICE);
  });

  it('returns null for unknown alias', () => {
    expect(graph.findByAlias('unknown-alias-xyz')).toBeNull();
  });

  it('auto-creates aliases from entity name on create', () => {
    graph.createEntity({ type: 'system', name: 'API Gateway' });

    const byLower = graph.findByAlias('api gateway');
    expect(byLower).not.toBeNull();
    expect(byLower!.id).toBe('system-api-gateway');

    const bySlug = graph.findByAlias('api-gateway');
    expect(bySlug).not.toBeNull();
    expect(bySlug!.id).toBe('system-api-gateway');
  });

  it('removes aliases when entity is deleted', () => {
    graph.addAlias(AUTH_SERVICE, 'my-auth');

    graph.deleteEntity(AUTH_SERVICE);

    const entity = graph.findByAlias('my-auth');
    expect(entity).toBeNull();
  });
});
