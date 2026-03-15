import type Database from 'better-sqlite3';

/**
 * Initialises the entity graph SQLite schema.
 * Safe to call multiple times — all statements use IF NOT EXISTS.
 */
export function initGraphSchema(db: InstanceType<typeof Database>): void {
  // Pragmas — must be set before DDL so WAL is active from the start
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id       TEXT PRIMARY KEY,
      type     TEXT NOT NULL,
      name     TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created  TEXT NOT NULL,
      updated  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS edges (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation  TEXT NOT NULL,
      weight    REAL NOT NULL DEFAULT 1.0,
      metadata  TEXT NOT NULL DEFAULT '{}',
      created   TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id, relation),
      FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS entity_aliases (
      entity_id TEXT NOT NULL,
      alias     TEXT NOT NULL,
      PRIMARY KEY (entity_id, alias),
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS access_grants (
      knowledge_id       TEXT NOT NULL,
      grantee_entity_id  TEXT NOT NULL,
      granted_by         TEXT NOT NULL,
      created            TEXT NOT NULL,
      PRIMARY KEY (knowledge_id, grantee_entity_id)
    );

    CREATE TABLE IF NOT EXISTS gravity_state (
      key     TEXT PRIMARY KEY,
      value   TEXT NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_edges_target  ON edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_aliases_alias  ON entity_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_grants_grantee ON access_grants(grantee_entity_id);
  `);
}
