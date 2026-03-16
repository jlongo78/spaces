import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EntityGraph } from '@/lib/cortex/graph/entity-graph';

describe('EntityGraph — Traversal', () => {
  let tmpDir: string;
  let graph: EntityGraph;

  // Entity ids
  const ACME = 'organization-acme';
  const ENGINEERING = 'department-engineering';
  const SECURITY_DEPT = 'department-security-dept';
  const PLATFORM = 'team-platform';
  const SECURITY_TEAM = 'team-security';
  const ALICE = 'person-alice';
  const BOB = 'person-bob';
  const AUTH_TOPIC = 'topic-auth';
  const AUTH_SERVICE = 'system-auth-service';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-traversal-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));

    // Seed entities
    graph.createEntity({ id: ACME, type: 'organization', name: 'Acme' });
    graph.createEntity({ id: ENGINEERING, type: 'department', name: 'Engineering' });
    graph.createEntity({ id: SECURITY_DEPT, type: 'department', name: 'Security Dept' });
    graph.createEntity({ id: PLATFORM, type: 'team', name: 'Platform' });
    graph.createEntity({ id: SECURITY_TEAM, type: 'team', name: 'Security' });
    graph.createEntity({ id: ALICE, type: 'person', name: 'Alice' });
    graph.createEntity({ id: BOB, type: 'person', name: 'Bob' });
    graph.createEntity({ id: AUTH_TOPIC, type: 'topic', name: 'Auth' });
    graph.createEntity({ id: AUTH_SERVICE, type: 'system', name: 'Auth Service' });

    // Seed edges
    graph.createEdge({ source_id: ALICE, target_id: PLATFORM, relation: 'member_of' });
    graph.createEdge({ source_id: BOB, target_id: PLATFORM, relation: 'member_of' });
    graph.createEdge({ source_id: PLATFORM, target_id: ENGINEERING, relation: 'part_of' });
    graph.createEdge({ source_id: SECURITY_TEAM, target_id: SECURITY_DEPT, relation: 'part_of' });
    graph.createEdge({ source_id: ENGINEERING, target_id: ACME, relation: 'part_of' });
    graph.createEdge({ source_id: SECURITY_DEPT, target_id: ACME, relation: 'part_of' });
    graph.createEdge({ source_id: ALICE, target_id: AUTH_TOPIC, relation: 'expert_in' });
    graph.createEdge({ source_id: PLATFORM, target_id: AUTH_SERVICE, relation: 'owns' });
    graph.createEdge({ source_id: SECURITY_TEAM, target_id: AUTH_SERVICE, relation: 'owns' });
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('computes distance 0 to self', () => {
    expect(graph.distance(ALICE, ALICE)).toBe(0);
    expect(graph.distance(ACME, ACME)).toBe(0);
  });

  it('computes distance 1 for direct neighbors', () => {
    expect(graph.distance(ALICE, PLATFORM)).toBe(1);
    expect(graph.distance(ALICE, AUTH_TOPIC)).toBe(1);
  });

  it('computes distance 2 for two-hop paths', () => {
    // Alice → Platform → Engineering
    expect(graph.distance(ALICE, ENGINEERING)).toBe(2);
    // Alice → Platform ← Bob
    expect(graph.distance(ALICE, BOB)).toBe(2);
  });

  it('computes distance 3 for three-hop paths', () => {
    // Alice → Platform → Engineering → Acme
    expect(graph.distance(ALICE, ACME)).toBe(3);
  });

  it('traverses edges bidirectionally', () => {
    // Bob → Platform ← Alice (both member_of Platform)
    expect(graph.distance(BOB, ALICE)).toBe(2);
    // Engineering ← Platform ← Alice
    expect(graph.distance(ENGINEERING, ALICE)).toBe(2);
  });

  it('returns Infinity for unreachable entities', () => {
    const ISOLATED = 'topic-isolated';
    graph.createEntity({ id: ISOLATED, type: 'topic', name: 'Isolated' });

    expect(graph.distance(ALICE, ISOLATED)).toBe(Infinity);
    expect(graph.distance(ISOLATED, ALICE)).toBe(Infinity);
  });

  it('respects maxHops limit', () => {
    // Alice to Acme is 3 hops — should be Infinity with maxHops=2
    expect(graph.distance(ALICE, ACME, 2)).toBe(Infinity);
    // But reachable with maxHops=3
    expect(graph.distance(ALICE, ACME, 3)).toBe(3);
  });

  it('returns entities within 1 hop (neighborhood)', () => {
    const neighbors = graph.neighborhood(ALICE, 1);
    const ids = neighbors.map(e => e.id);

    expect(ids).toContain(PLATFORM);
    expect(ids).toContain(AUTH_TOPIC);
    // Engineering is 2 hops away
    expect(ids).not.toContain(ENGINEERING);
    // Self should not be included
    expect(ids).not.toContain(ALICE);
  });

  it('returns entities within 2 hops', () => {
    const neighbors = graph.neighborhood(ALICE, 2);
    const ids = neighbors.map(e => e.id);

    expect(ids).toContain(PLATFORM);     // hop 1
    expect(ids).toContain(AUTH_TOPIC);   // hop 1
    expect(ids).toContain(ENGINEERING);  // hop 2
    expect(ids).toContain(BOB);          // hop 2
    expect(ids).toContain(AUTH_SERVICE); // hop 2 (Platform owns Auth Service)
    expect(ids).not.toContain(ALICE);
  });

  it('computes graph proximity score', () => {
    const ORPHANED = 'topic-orphaned';
    graph.createEntity({ id: ORPHANED, type: 'topic', name: 'Orphaned' });

    // Self proximity is 1.0
    expect(graph.proximity(ALICE, ALICE)).toBe(1.0);

    // Distance 1 → 1/(1+1) = 0.5
    expect(graph.proximity(ALICE, PLATFORM)).toBeCloseTo(0.5);

    // Distance 2 → 1/(1+2) ≈ 0.333
    expect(graph.proximity(ALICE, ENGINEERING)).toBeCloseTo(1 / 3);

    // Unreachable → 0
    expect(graph.proximity(ALICE, ORPHANED)).toBe(0);
  });
});
