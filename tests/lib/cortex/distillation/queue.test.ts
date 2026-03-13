import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DistillationQueue } from '@/lib/cortex/distillation/queue';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('DistillationQueue', () => {
  let tmpDir: string;
  let queue: DistillationQueue;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-queue-'));
    queue = new DistillationQueue(tmpDir);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  const entry = { text: 'chunk text 1', layerKey: 'personal', workspaceId: null, agentType: 'claude' };

  it('enqueues and retrieves chunks by id', () => {
    queue.enqueue('id1', entry);
    queue.enqueue('id2', { ...entry, text: 'chunk text 2' });

    const texts = queue.getTexts(['id1', 'id2']);
    expect(texts).toEqual(['chunk text 1', 'chunk text 2']);
  });

  it('getEntries returns full context', () => {
    queue.enqueue('id1', { text: 'ws text', layerKey: 'workspace/5', workspaceId: 5, agentType: 'claude' });
    const entries = queue.getEntries(['id1']);
    expect(entries[0].layerKey).toBe('workspace/5');
    expect(entries[0].workspaceId).toBe(5);
  });

  it('removes processed entries', () => {
    queue.enqueue('id1', entry);
    queue.remove(['id1']);
    expect(queue.getTexts(['id1'])).toEqual([]);
  });

  it('persists to disk and recovers', () => {
    queue.enqueue('id1', entry);

    const queue2 = new DistillationQueue(tmpDir);
    expect(queue2.pendingIds()).toEqual(['id1']);
    expect(queue2.getTexts(['id1'])).toEqual(['chunk text 1']);
  });
});
