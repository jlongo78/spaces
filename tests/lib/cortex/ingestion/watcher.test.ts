import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { IngestionWatcher } from '@/lib/cortex/ingestion/watcher';

describe('IngestionWatcher', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-watcher-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports new files as needing sync', () => {
    const watcher = new IngestionWatcher(tmpDir);
    const testFile = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(testFile, '{"type":"human"}\n');
    expect(watcher.needsSync(testFile)).toBe(true);
  });

  it('reports synced files as not needing sync', () => {
    const watcher = new IngestionWatcher(tmpDir);
    const testFile = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(testFile, '{"type":"human"}\n');
    const size = fs.statSync(testFile).size;
    watcher.markSynced(testFile, size);
    expect(watcher.needsSync(testFile)).toBe(false);
  });

  it('persists and restores state', () => {
    const testFile = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(testFile, '{"type":"human"}\n');
    const size = fs.statSync(testFile).size;

    const watcher1 = new IngestionWatcher(tmpDir);
    watcher1.markSynced(testFile, size);
    watcher1.save();

    const watcher2 = new IngestionWatcher(tmpDir);
    expect(watcher2.needsSync(testFile)).toBe(false);
    expect(watcher2.getOffset(testFile)).toBe(size);
  });

  it('detects file changes after sync', () => {
    const watcher = new IngestionWatcher(tmpDir);
    const testFile = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(testFile, '{"type":"human"}\n');
    watcher.markSynced(testFile, fs.statSync(testFile).size);

    fs.appendFileSync(testFile, '{"type":"assistant"}\n');
    expect(watcher.needsSync(testFile)).toBe(true);
  });
});
