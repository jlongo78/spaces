// tests/proto/session-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createSessionStore } from '../../bin/lib/runtime/session-store.js';

let dir: string, dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-store-'));
  dbPath = path.join(dir, 'spaces.db');
  const db = new Database(dbPath);
  // Minimal mirror of the production schema — verified against
  // src/lib/db/schema.ts. workspaces.name is the only NOT NULL column that
  // matters here. panes.title/color/cwd/sort_order are NOT NULL in production
  // (grid_col/grid_row are also NOT NULL there but are never touched by this
  // store, so they're omitted from the mirror).
  //
  // panes.workspace_id is a bare INTEGER with NO REFERENCES clause in
  // production — it was added via `ALTER TABLE panes ADD COLUMN
  // workspace_id INTEGER` with no FK. Deliberately mirrored the same way
  // here (no ON DELETE CASCADE) so this test schema can't hide a store bug
  // that relies on a cascade that doesn't actually exist.
  db.exec(`
    CREATE TABLE workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT
    );
    CREATE TABLE panes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Terminal',
      color TEXT NOT NULL DEFAULT '#6366f1',
      cwd TEXT NOT NULL,
      agent_type TEXT DEFAULT 'shell',
      sort_order INTEGER NOT NULL DEFAULT 0,
      workspace_id INTEGER
    );
  `);
  db.close();
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const read = (sql: string) => {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare(sql).all(); } finally { db.close(); }
};

describe('createSessionStore', () => {
  it('creates a workspace and returns its numeric id', () => {
    const store = createSessionStore({ dbPath });
    const res = store.createWorkspace({ name: 'frontend', color: '#89b4fa' }) as any;
    expect(res.ok).toBe(true);
    expect(typeof res.id).toBe('number');
    expect(read('SELECT name, color FROM workspaces')).toEqual([{ name: 'frontend', color: '#89b4fa' }]);
    store.close();
  });

  it('updates only the provided workspace fields', () => {
    const store = createSessionStore({ dbPath });
    const { id } = store.createWorkspace({ name: 'api', color: '#f38ba8' }) as any;
    expect((store.updateWorkspace(id, { name: 'api-v2' }) as any).ok).toBe(true);
    expect(read('SELECT name, color FROM workspaces')).toEqual([{ name: 'api-v2', color: '#f38ba8' }]);
    store.close();
  });

  it('rejects an update with no fields', () => {
    const store = createSessionStore({ dbPath });
    const { id } = store.createWorkspace({ name: 'x', color: null }) as any;
    const res = store.updateWorkspace(id, {}) as any;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no fields/i);
    store.close();
  });

  it('reports not-found for a missing workspace', () => {
    const store = createSessionStore({ dbPath });
    expect((store.updateWorkspace(9999, { name: 'ghost' }) as any).ok).toBe(false);
    expect((store.closeWorkspace(9999) as any).ok).toBe(false);
    store.close();
  });

  it('creates a pane bound to a workspace', () => {
    const store = createSessionStore({ dbPath });
    const { id } = store.createWorkspace({ name: 'w', color: null }) as any;
    const res = store.createPane({
      paneId: 'p-abc', workspaceId: id, agentType: 'claude', cwd: 'C:\\work', title: 'claude',
    }) as any;
    expect(res.ok).toBe(true);
    expect(read('SELECT id, agent_type, cwd, workspace_id FROM panes')).toEqual([
      { id: 'p-abc', agent_type: 'claude', cwd: 'C:\\work', workspace_id: id },
    ]);
    store.close();
  });

  it('rejects a duplicate pane id', () => {
    const store = createSessionStore({ dbPath });
    const { id } = store.createWorkspace({ name: 'w', color: null }) as any;
    const args = { paneId: 'dup', workspaceId: id, agentType: 'shell', cwd: '.', title: 't' };
    expect((store.createPane(args) as any).ok).toBe(true);
    const second = store.createPane(args) as any;
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/exists|unique|constraint/i);
    store.close();
  });

  it('rejects a pane bound to a missing workspace', () => {
    const store = createSessionStore({ dbPath });
    const res = store.createPane({
      paneId: 'orphan', workspaceId: 4242, agentType: 'shell', cwd: '.', title: 't',
    }) as any;
    expect(res.ok).toBe(false);
    expect(read('SELECT id FROM panes')).toEqual([]);
    store.close();
  });

  it('moves a pane between workspaces', () => {
    const store = createSessionStore({ dbPath });
    const a = (store.createWorkspace({ name: 'a', color: null }) as any).id;
    const b = (store.createWorkspace({ name: 'b', color: null }) as any).id;
    store.createPane({ paneId: 'p1', workspaceId: a, agentType: 'shell', cwd: '.', title: 't' });
    expect((store.movePane('p1', b) as any).ok).toBe(true);
    expect(read('SELECT workspace_id FROM panes')).toEqual([{ workspace_id: b }]);
    expect((store.movePane('nope', b) as any).ok).toBe(false);
    expect((store.movePane('p1', 9999) as any).ok).toBe(false);
    store.close();
  });

  it('deletes a pane, then explicitly deletes the rest on workspace close', () => {
    const store = createSessionStore({ dbPath });
    const { id } = store.createWorkspace({ name: 'w', color: null }) as any;
    store.createPane({ paneId: 'p1', workspaceId: id, agentType: 'shell', cwd: '.', title: 't' });
    store.createPane({ paneId: 'p2', workspaceId: id, agentType: 'shell', cwd: '.', title: 't' });
    expect((store.deletePane('p1') as any).ok).toBe(true);
    expect(read('SELECT id FROM panes')).toEqual([{ id: 'p2' }]);
    const res = store.closeWorkspace(id) as any;
    expect(res.ok).toBe(true);
    expect(res.deletedPaneIds).toEqual(['p2']);
    expect(read('SELECT id FROM panes')).toEqual([]);
    store.close();
  });

  it('reports no deleted panes when closing an empty workspace', () => {
    const store = createSessionStore({ dbPath });
    const { id } = store.createWorkspace({ name: 'empty', color: null }) as any;
    const res = store.closeWorkspace(id) as any;
    expect(res).toEqual({ ok: true, deletedPaneIds: [] });
    store.close();
  });

  it('returns an error rather than throwing when the db file is missing', () => {
    const store = createSessionStore({ dbPath: path.join(dir, 'absent.db') });
    const res = store.createWorkspace({ name: 'x', color: null }) as any;
    expect(res.ok).toBe(false);
    expect(() => store.close()).not.toThrow();
  });

  it('returns a closed error for every write after close(), leaving rows unchanged', () => {
    const store = createSessionStore({ dbPath });
    const { id: wsId } = store.createWorkspace({ name: 'w', color: null }) as any;
    store.createPane({ paneId: 'p1', workspaceId: wsId, agentType: 'shell', cwd: '.', title: 't' });
    const workspacesBefore = read('SELECT id, name, color FROM workspaces');
    const panesBefore = read('SELECT id, workspace_id FROM panes');

    store.close();
    const closedError = /closed/i;

    const createWs = store.createWorkspace({ name: 'nope', color: null }) as any;
    expect(createWs.ok).toBe(false);
    expect(createWs.error).toMatch(closedError);

    const updateWs = store.updateWorkspace(wsId, { name: 'nope' }) as any;
    expect(updateWs.ok).toBe(false);
    expect(updateWs.error).toMatch(closedError);

    const closeWs = store.closeWorkspace(wsId) as any;
    expect(closeWs.ok).toBe(false);
    expect(closeWs.error).toMatch(closedError);

    const createPane = store.createPane({
      paneId: 'p2', workspaceId: wsId, agentType: 'shell', cwd: '.', title: 't',
    }) as any;
    expect(createPane.ok).toBe(false);
    expect(createPane.error).toMatch(closedError);

    const deletePane = store.deletePane('p1') as any;
    expect(deletePane.ok).toBe(false);
    expect(deletePane.error).toMatch(closedError);

    const movePane = store.movePane('p1', wsId) as any;
    expect(movePane.ok).toBe(false);
    expect(movePane.error).toMatch(closedError);

    // Not one of the calls above actually touched a row.
    expect(read('SELECT id, name, color FROM workspaces')).toEqual(workspacesBefore);
    expect(read('SELECT id, workspace_id FROM panes')).toEqual(panesBefore);
  });

  it('does not throw when close() is called twice', () => {
    const store = createSessionStore({ dbPath });
    store.createWorkspace({ name: 'w', color: null });
    expect(() => store.close()).not.toThrow();
    expect(() => store.close()).not.toThrow();
  });

  // Kept last, with its own temp dir, so it doesn't fight the shared
  // beforeEach/afterEach dir used by every test above. This is the
  // assertion that actually proves the OS-level handle was released: on
  // Windows, a lingering open SQLite handle blocks removing (or even
  // renaming) the file that held it, which is exactly the bug being fixed.
  it('releases the OS file handle so its directory can be removed', () => {
    const ownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-store-close-'));
    const ownDbPath = path.join(ownDir, 'spaces.db');
    const seed = new Database(ownDbPath);
    seed.exec(`
      CREATE TABLE workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT
      );
      CREATE TABLE panes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'Terminal',
        color TEXT NOT NULL DEFAULT '#6366f1',
        cwd TEXT NOT NULL,
        agent_type TEXT DEFAULT 'shell',
        sort_order INTEGER NOT NULL DEFAULT 0,
        workspace_id INTEGER
      );
    `);
    seed.close();

    const store = createSessionStore({ dbPath: ownDbPath });
    store.createWorkspace({ name: 'w', color: null }); // forces the connection open
    store.close();

    expect(() => fs.rmSync(ownDir, { recursive: true, force: true })).not.toThrow();
    expect(fs.existsSync(ownDir)).toBe(false);
  });
});

// Issue #38: another macOS app named "Spaces" also keeps ~/.spaces/spaces.db,
// with its own `workspaces` table. The store must say so instead of failing
// with "table workspaces has no column named name".
describe('createSessionStore with another app\'s spaces.db', () => {
  const seed = (sql: string) => {
    fs.rmSync(dbPath, { force: true });
    const db = new Database(dbPath);
    db.exec(sql);
    db.close();
  };

  it('refuses an unmarked database whose workspaces table is not ours', () => {
    seed('CREATE TABLE workspaces (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, dir TEXT NOT NULL);');
    const store = createSessionStore({ dbPath });
    const res = store.createWorkspace({ name: 'x' }) as any;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/another application/);
    expect(res.error).toContain(dbPath);
    store.close();
  });

  it('refuses a database marked by a different application', () => {
    seed(`CREATE TABLE workspaces (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT, color TEXT);
          PRAGMA application_id = 12345;`);
    const store = createSessionStore({ dbPath });
    const res = store.createWorkspace({ name: 'x' }) as any;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/another application/);
    store.close();
  });
});
