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

  const AUTH_SERVICE = 'system-auth-service';
  const API_GATEWAY = 'system-api-gateway';
  const AUTH_TOPIC = 'topic-authentication';
  const PERF_TOPIC = 'topic-performance';
  const ALICE = 'person-alice-smith';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-resolver-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));

    graph.createEntity({ id: AUTH_SERVICE, type: 'system', name: 'Auth Service' });
    graph.createEntity({ id: API_GATEWAY, type: 'system', name: 'API Gateway' });
    graph.createEntity({ id: AUTH_TOPIC, type: 'topic', name: 'Authentication' });
    graph.createEntity({ id: PERF_TOPIC, type: 'topic', name: 'Performance' });
    graph.createEntity({ id: ALICE, type: 'person', name: 'Alice Smith' });

    // Add explicit aliases for auth-service
    graph.addAlias(AUTH_SERVICE, 'auth');
    graph.addAlias(AUTH_SERVICE, 'auth-svc');

    resolver = new EntityResolver(graph);
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('resolves exact alias match', () => {
    const result = resolver.resolve('auth');
    expect(result).not.toBeNull();
    expect(result!.entity.id).toBe(AUTH_SERVICE);
    expect(result!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result!.method).toBe('alias');
  });

  it('resolves fuzzy alias match', () => {
    // 'auth servce' has a typo — distance 1 from 'auth service'
    const result = resolver.resolve('auth servce');
    expect(result).not.toBeNull();
    expect(result!.entity.id).toBe(AUTH_SERVICE);
    expect(result!.method).toBe('fuzzy');
    expect(result!.confidence).toBeLessThan(0.95);
  });

  it('returns null for unresolvable text', () => {
    const result = resolver.resolve('completely unknown xyz');
    expect(result).toBeNull();
  });

  it('extracts multiple entities from text', () => {
    const results = resolver.extractEntities('fix the auth service performance issue');
    const ids = results.map(r => r.entity.id);
    expect(ids).toContain(AUTH_SERVICE);
    expect(ids).toContain(PERF_TOPIC);
  });

  it('prefers exact alias over fuzzy match', () => {
    const result = resolver.resolve('auth');
    expect(result).not.toBeNull();
    expect(result!.method).toBe('alias');
  });
});
