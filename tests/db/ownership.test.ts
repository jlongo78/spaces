import { describe, it, expect, vi, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('@/lib/config', () => ({ getUserPaths: vi.fn(), ensureUserSpacesDir: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn(() => 'local') }));

const { claimDatabase, ForeignDatabaseError, SPACES_APPLICATION_ID } = await import('@/lib/db/ownership');
const { getDb, closeDb } = await import('@/lib/db/schema');
const { getUserPaths } = await import('@/lib/config');

const appId = (db: Database.Database) => db.pragma('application_id', { simple: true });

// The table another macOS app named "Spaces" left in ~/.spaces/spaces.db (issue #38).
const FOREIGN_WORKSPACES = `
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, dir TEXT NOT NULL, dirname TEXT,
    branch TEXT, base_branch TEXT, is_default INTEGER NOT NULL,
    is_hidden INTEGER NOT NULL DEFAULT 0, is_running INTEGER NOT NULL,
    last_launched_at TEXT, notes TEXT
  );`;

// An install from before databases were marked: our tables, application_id 0.
const OUR_UNMARKED = `
  CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, claude_path TEXT NOT NULL);
  CREATE TABLE workspaces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, color TEXT);
  CREATE TABLE panes (id TEXT PRIMARY KEY, title TEXT, cwd TEXT NOT NULL);
  INSERT INTO workspaces (name) VALUES ('mine');`;

describe('claimDatabase', () => {
  it('marks a brand-new, empty database as ours', () => {
    const db = new Database(':memory:');
    claimDatabase(db, '/x/spaces.db');
    expect(appId(db)).toBe(SPACES_APPLICATION_ID);
  });

  it('marks an existing unmarked database that has our tables, keeping its data', () => {
    const db = new Database(':memory:');
    db.exec(OUR_UNMARKED);
    claimDatabase(db, '/x/spaces.db');
    expect(appId(db)).toBe(SPACES_APPLICATION_ID);
    expect(db.prepare('SELECT name FROM workspaces').all()).toEqual([{ name: 'mine' }]);
  });

  it('accepts a database already marked as ours', () => {
    const db = new Database(':memory:');
    db.exec(FOREIGN_WORKSPACES); // contents are not re-checked once marked
    db.pragma(`application_id = ${SPACES_APPLICATION_ID}`);
    expect(() => claimDatabase(db, '/x/spaces.db')).not.toThrow();
  });

  it('refuses an unmarked database whose tables belong to another app, and leaves it untouched', () => {
    const db = new Database(':memory:');
    db.exec(FOREIGN_WORKSPACES);
    expect(() => claimDatabase(db, '/x/spaces.db')).toThrow(ForeignDatabaseError);
    expect(appId(db)).toBe(0);
    const cols = (db.prepare('PRAGMA table_info(workspaces)').all() as { name: string }[]).map(c => c.name);
    expect(cols).not.toContain('name');
  });

  it('refuses an unmarked database with only unrelated tables', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT);');
    expect(() => claimDatabase(db, '/x/spaces.db')).toThrow(ForeignDatabaseError);
  });

  it('refuses a database marked by a different application', () => {
    const db = new Database(':memory:');
    db.pragma('application_id = 12345');
    expect(() => claimDatabase(db, '/x/spaces.db')).toThrow(ForeignDatabaseError);
  });

  it('names the file in the error so the user knows what to move', () => {
    const db = new Database(':memory:');
    db.exec(FOREIGN_WORKSPACES);
    expect(() => claimDatabase(db, '/home/k/.spaces/spaces.db')).toThrow(/\/home\/k\/\.spaces\/spaces\.db/);
  });
});

describe('getDb with another app\'s spaces.db', () => {
  let dir: string;
  afterEach(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws instead of migrating the foreign tables', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-own-'));
    const dbPath = path.join(dir, 'spaces.db');
    const seed = new Database(dbPath);
    seed.exec(FOREIGN_WORKSPACES);
    seed.close();
    vi.mocked(getUserPaths).mockReturnValue({ dbPath } as ReturnType<typeof getUserPaths>);

    expect(() => getDb()).toThrow(ForeignDatabaseError);

    const check = new Database(dbPath, { readonly: true });
    const cols = (check.prepare('PRAGMA table_info(workspaces)').all() as { name: string }[]).map(c => c.name);
    const tables = check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    check.close();
    expect(cols).not.toContain('is_active');
    expect(tables).toEqual([{ name: 'workspaces' }]);
  });
});
