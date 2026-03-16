import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { AuditLog } from '@/lib/cortex/boundary/audit';

// ─── Test infrastructure ──────────────────────────────────────────────────────

let tmpDir: string;
let db: InstanceType<typeof Database>;
let audit: AuditLog;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-audit-'));
  db = new Database(path.join(tmpDir, 'audit.db'));
  audit = new AuditLog(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuditLog', () => {
  it('logs an access decision and retrieves it', () => {
    audit.log({
      requester_id: 'person-alice',
      knowledge_id: 'k-001',
      action: 'allow',
      reason: 'public knowledge',
    });

    const records = audit.query({ requester_id: 'person-alice' });
    expect(records).toHaveLength(1);
    expect(records[0].requester_id).toBe('person-alice');
    expect(records[0].knowledge_id).toBe('k-001');
    expect(records[0].action).toBe('allow');
    expect(records[0].reason).toBe('public knowledge');
    expect(records[0].timestamp).toBeDefined();
    expect(records[0].id).toBeGreaterThan(0);
  });

  it('logs denied access', () => {
    audit.log({
      requester_id: 'person-bob',
      knowledge_id: 'k-002',
      action: 'deny',
      reason: 'confidential — not creator',
    });

    const records = audit.query({ action: 'deny' });
    expect(records).toHaveLength(1);
    expect(records[0].action).toBe('deny');
    expect(records[0].reason).toBe('confidential — not creator');
  });

  it('queries by time range (since parameter)', () => {
    const past = '2024-01-01T00:00:00.000Z';
    const recent = new Date().toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();

    audit.log({
      requester_id: 'person-alice',
      knowledge_id: 'k-old',
      action: 'allow',
      reason: 'old entry',
      timestamp: past,
    });

    audit.log({
      requester_id: 'person-alice',
      knowledge_id: 'k-new',
      action: 'allow',
      reason: 'recent entry',
      timestamp: recent,
    });

    // Query only from the recent timestamp onward
    const records = audit.query({ since: recent });
    expect(records).toHaveLength(1);
    expect(records[0].knowledge_id).toBe('k-new');

    // Query from far future — should return nothing
    const none = audit.query({ since: future });
    expect(none).toHaveLength(0);
  });

  it('supports retention cleanup (cleanup(0) removes everything)', () => {
    audit.log({
      requester_id: 'person-alice',
      knowledge_id: 'k-a',
      action: 'allow',
      reason: 'test',
    });

    audit.log({
      requester_id: 'person-bob',
      knowledge_id: 'k-b',
      action: 'deny',
      reason: 'test',
    });

    // Sanity check: both records exist
    expect(audit.query()).toHaveLength(2);

    // cleanup(0) deletes entries older than 0 days, i.e. everything
    audit.cleanup(0);

    expect(audit.query()).toHaveLength(0);
  });
});
