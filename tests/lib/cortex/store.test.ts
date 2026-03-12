import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CortexStore } from '@/lib/cortex/store';

describe('CortexStore', () => {
  let tmpDir: string;
  let store: CortexStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-store-'));
    store = new CortexStore(tmpDir);
    await store.init(384); // MiniLM dimensions
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes and creates data directory', async () => {
    expect(fs.existsSync(path.join(tmpDir, 'personal'))).toBe(true);
  });

  it('adds and searches knowledge units', async () => {
    const vector = new Array(384).fill(0).map(() => Math.random());
    await store.add('personal', {
      id: 'test-1',
      vector,
      text: 'Use JWT for auth',
      type: 'decision',
      layer: 'personal',
      workspace_id: null,
      session_id: 'sess-1',
      agent_type: 'claude',
      project_path: '/project',
      file_refs: ['src/auth.ts'],
      confidence: 0.85,
      created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(),
      stale_score: 0,
      access_count: 0,
      last_accessed: null,
      metadata: {},
    });

    const results = await store.search('personal', vector, 5);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Use JWT for auth');
  });

  it('deletes knowledge units by id', async () => {
    const vector = new Array(384).fill(0.5);
    await store.add('personal', {
      id: 'del-1', vector, text: 'to delete', type: 'context',
      layer: 'personal', workspace_id: null, session_id: null,
      agent_type: 'claude', project_path: null, file_refs: [],
      confidence: 0.5, created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(), stale_score: 0,
      access_count: 0, last_accessed: null, metadata: {},
    });

    await store.delete('personal', 'del-1');
    const results = await store.search('personal', vector, 5);
    expect(results).toHaveLength(0);
  });

  it('reports stats', async () => {
    const stats = await store.stats();
    expect(stats).toHaveProperty('personal');
    expect(typeof stats.personal.count).toBe('number');
  });
});
