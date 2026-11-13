import type Database from 'better-sqlite3';

/**
 * Marks spaces.db as ours, and refuses a spaces.db that isn't (issue #38).
 *
 * Another macOS app, also called "Spaces", keeps its data in ~/.spaces as
 * well, including a spaces.db with its own `workspaces` table. Our schema
 * setup is all CREATE TABLE IF NOT EXISTS plus ALTER TABLE ADD COLUMN, so on
 * that file it kept the other app's tables and grafted our columns onto them.
 *
 * SQLite's application_id header field exists for exactly this. "SPCS" in
 * ASCII. The terminal runtime checks the same mark before writing; see
 * bin/lib/runtime/session-store.js.
 */
export const SPACES_APPLICATION_ID = 0x53504353;

export class ForeignDatabaseError extends Error {
  constructor(readonly dbPath: string, reason: string) {
    super(
      `${dbPath} belongs to another application (${reason}). ` +
      `Spaces will not change it. Move or rename that file, or set SPACES_HOME to keep Spaces' data in another folder, then start Spaces again.`,
    );
    this.name = 'ForeignDatabaseError';
  }
}

// Columns every spaces.db we have ever created has had. Databases from before
// the mark was introduced are recognised by these, then marked.
const SIGNATURE: Record<string, string> = {
  projects: 'claude_path',
  workspaces: 'name',
  panes: 'cwd',
};

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some(c => c.name === col);
}

/**
 * Call on a freshly opened connection, before creating or migrating anything.
 * Marks an empty or recognisably-ours database; throws ForeignDatabaseError
 * (without writing) for anything else.
 */
export function claimDatabase(db: Database.Database, dbPath: string): void {
  const id = db.pragma('application_id', { simple: true }) as number;
  if (id === SPACES_APPLICATION_ID) return;
  if (id !== 0) throw new ForeignDatabaseError(dbPath, `application_id ${id}`);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];

  if (tables.length > 0) {
    for (const [table, col] of Object.entries(SIGNATURE)) {
      if (!hasColumn(db, table, col)) {
        throw new ForeignDatabaseError(dbPath, `no ${table}.${col} column`);
      }
    }
  }

  db.pragma(`application_id = ${SPACES_APPLICATION_ID}`);
}
