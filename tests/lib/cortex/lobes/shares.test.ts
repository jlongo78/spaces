import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { LobeShareStore } from '@/lib/cortex/lobes/shares';

let tmpDir: string;
let db: InstanceType<typeof Database>;
let store: LobeShareStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-shares-'));
  db = new Database(path.join(tmpDir, 'shares.db'));
  store = new LobeShareStore(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('LobeShareStore', () => {
  it('creates a share (id defined, accepted=false)', () => {
    const share = store.share({
      id: 'share-001',
      ownerUserId: 'user-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'auth-lobe',
      sharedWithUserId: 'user-bob',
    });

    expect(share.id).toBe('share-001');
    expect(share.owner_user_id).toBe('user-alice');
    expect(share.owner_workspace_id).toBe(1);
    expect(share.owner_lobe_name).toBe('auth-lobe');
    expect(share.shared_with_user_id).toBe('user-bob');
    expect(share.accepted).toBe(false);
    expect(share.created).toBeDefined();
  });

  it('accepts a share (accepted becomes true)', () => {
    store.share({
      id: 'share-002',
      ownerUserId: 'user-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'auth-lobe',
      sharedWithUserId: 'user-bob',
    });

    store.accept('share-002');

    const updated = store.getShare('share-002');
    expect(updated).not.toBeNull();
    expect(updated!.accepted).toBe(true);
  });

  it('lists incoming shares for a user (2 shares from different owners)', () => {
    store.share({
      id: 'share-003',
      ownerUserId: 'user-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'auth-lobe',
      sharedWithUserId: 'user-carol',
    });

    store.share({
      id: 'share-004',
      ownerUserId: 'user-bob',
      ownerWorkspaceId: 2,
      ownerLobeName: 'frontend-lobe',
      sharedWithUserId: 'user-carol',
    });

    // A share to someone else — should NOT appear
    store.share({
      id: 'share-005',
      ownerUserId: 'user-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'auth-lobe',
      sharedWithUserId: 'user-dave',
    });

    const incoming = store.listIncoming('user-carol');
    expect(incoming).toHaveLength(2);
    const ids = incoming.map((s) => s.id);
    expect(ids).toContain('share-003');
    expect(ids).toContain('share-004');
  });

  it('lists outgoing shares for a user', () => {
    store.share({
      id: 'share-006',
      ownerUserId: 'user-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'auth-lobe',
      sharedWithUserId: 'user-bob',
    });

    store.share({
      id: 'share-007',
      ownerUserId: 'user-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'auth-lobe',
      sharedWithUserId: 'user-carol',
    });

    // A share from someone else — should NOT appear
    store.share({
      id: 'share-008',
      ownerUserId: 'user-bob',
      ownerWorkspaceId: 2,
      ownerLobeName: 'frontend-lobe',
      sharedWithUserId: 'user-alice',
    });

    const outgoing = store.listOutgoing('user-alice');
    expect(outgoing).toHaveLength(2);
    const ids = outgoing.map((s) => s.id);
    expect(ids).toContain('share-006');
    expect(ids).toContain('share-007');
  });

  it('revokes a share (getShare returns null)', () => {
    store.share({
      id: 'share-009',
      ownerUserId: 'user-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'auth-lobe',
      sharedWithUserId: 'user-bob',
    });

    expect(store.getShare('share-009')).not.toBeNull();

    store.revoke('share-009');

    expect(store.getShare('share-009')).toBeNull();
  });

  it('prevents duplicate shares (same owner+workspace+recipient => still 1 share)', () => {
    const first = store.share({
      id: 'share-010',
      ownerUserId: 'user-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'auth-lobe',
      sharedWithUserId: 'user-bob',
    });

    // Same owner+workspace+recipient, different id — INSERT OR IGNORE fires, returns existing
    const second = store.share({
      id: 'share-011',
      ownerUserId: 'user-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'auth-lobe',
      sharedWithUserId: 'user-bob',
    });

    expect(second.id).toBe(first.id);

    const outgoing = store.listOutgoing('user-alice');
    expect(outgoing).toHaveLength(1);
  });
});
