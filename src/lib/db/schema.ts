import Database from 'better-sqlite3';
import { config, ensureSpacesDir } from '../config';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  ensureSpacesDir();

  _db = new Database(config.dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');

  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      claude_path TEXT NOT NULL,
      session_count INTEGER DEFAULT 0,
      last_activity TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      first_prompt TEXT,
      summary TEXT,
      message_count INTEGER DEFAULT 0,
      created TEXT,
      modified TEXT,
      git_branch TEXT,
      project_path TEXT,
      full_path TEXT NOT NULL,
      starred INTEGER DEFAULT 0,
      custom_name TEXT,
      notes TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created);
    CREATE INDEX IF NOT EXISTS idx_sessions_modified ON sessions(modified);
    CREATE INDEX IF NOT EXISTS idx_sessions_starred ON sessions(starred);

    CREATE TABLE IF NOT EXISTS workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#6366f1',
      created TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_sessions (
      workspace_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, session_id),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#8b5cf6'
    );

    CREATE TABLE IF NOT EXISTS session_tags (
      session_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (session_id, tag_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      file_path TEXT PRIMARY KEY,
      mtime INTEGER,
      byte_offset INTEGER DEFAULT 0,
      last_synced TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS panes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Terminal',
      color TEXT NOT NULL DEFAULT '#6366f1',
      cwd TEXT NOT NULL,
      claude_session_id TEXT,
      grid_col INTEGER NOT NULL DEFAULT 0,
      grid_row INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      shell TEXT,
      created TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrate: add workspace and popout columns to existing tables
  const addCol = (table: string, col: string, def: string) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
  };

  // Workspaces: add active tracking
  addCol('workspaces', 'is_active', 'INTEGER DEFAULT 0');
  addCol('workspaces', 'updated', 'TEXT');

  // Panes: add workspace ownership, popout tracking, and agent type
  addCol('panes', 'workspace_id', 'INTEGER');
  addCol('panes', 'is_popout', 'INTEGER DEFAULT 0');
  addCol('panes', 'win_x', 'INTEGER');
  addCol('panes', 'win_y', 'INTEGER');
  addCol('panes', 'win_width', 'INTEGER DEFAULT 800');
  addCol('panes', 'win_height', 'INTEGER DEFAULT 600');
  addCol('panes', 'agent_type', "TEXT DEFAULT 'shell'");
  addCol('panes', 'custom_command', 'TEXT');

  // Ensure a Default workspace exists and orphan panes get assigned to it
  const defaultWs = db.prepare("SELECT id FROM workspaces WHERE name = 'Default'").get() as { id: number } | undefined;
  let defaultWsId: number;
  if (!defaultWs) {
    const r = db.prepare("INSERT INTO workspaces (name, description, color, is_active) VALUES ('Default', 'Default workspace', '#6366f1', 1)").run();
    defaultWsId = Number(r.lastInsertRowid);
  } else {
    defaultWsId = defaultWs.id;
    // Ensure at least one workspace is active
    const anyActive = db.prepare('SELECT id FROM workspaces WHERE is_active = 1').get();
    if (!anyActive) {
      db.prepare('UPDATE workspaces SET is_active = 1 WHERE id = ?').run(defaultWsId);
    }
  }

  // Assign orphan panes (workspace_id IS NULL) to the active workspace
  const activeWs = db.prepare('SELECT id FROM workspaces WHERE is_active = 1').get() as { id: number } | undefined;
  if (activeWs) {
    db.prepare('UPDATE panes SET workspace_id = ? WHERE workspace_id IS NULL').run(activeWs.id);
  }

  // Create FTS5 virtual table if it doesn't exist
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        session_id,
        content,
        content_rowid='rowid'
      );
    `);
  } catch {
    // FTS5 may already exist
  }
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
