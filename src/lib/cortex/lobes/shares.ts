import type Database from 'better-sqlite3';

export interface LobeShare {
  id: string;
  owner_user_id: string;
  owner_workspace_id: number;
  owner_lobe_name: string;
  shared_with_user_id: string;
  accepted: boolean;
  created: string;
}

export interface CreateShareInput {
  id: string;
  ownerUserId: string;
  ownerWorkspaceId: number;
  ownerLobeName: string;
  sharedWithUserId: string;
}

type ShareRow = {
  id: string;
  owner_user_id: string;
  owner_workspace_id: number;
  owner_lobe_name: string;
  shared_with_user_id: string;
  accepted: number;
  created: string;
};

function rowToShare(row: ShareRow): LobeShare {
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    owner_workspace_id: row.owner_workspace_id,
    owner_lobe_name: row.owner_lobe_name,
    shared_with_user_id: row.shared_with_user_id,
    accepted: row.accepted === 1,
    created: row.created,
  };
}

export class LobeShareStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lobe_shares (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        owner_workspace_id INTEGER NOT NULL,
        owner_lobe_name TEXT NOT NULL,
        shared_with_user_id TEXT NOT NULL,
        accepted INTEGER DEFAULT 0,
        created TEXT NOT NULL,
        UNIQUE(owner_user_id, owner_workspace_id, shared_with_user_id)
      )
    `);
  }

  share(input: CreateShareInput): LobeShare {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO lobe_shares
          (id, owner_user_id, owner_workspace_id, owner_lobe_name, shared_with_user_id, accepted, created)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        input.id,
        input.ownerUserId,
        input.ownerWorkspaceId,
        input.ownerLobeName,
        input.sharedWithUserId,
        now,
      );

    // Return existing row (handles duplicate case where INSERT was ignored)
    const row = this.db
      .prepare(
        `SELECT * FROM lobe_shares
         WHERE owner_user_id = ? AND owner_workspace_id = ? AND shared_with_user_id = ?`,
      )
      .get(input.ownerUserId, input.ownerWorkspaceId, input.sharedWithUserId) as ShareRow;

    return rowToShare(row);
  }

  accept(id: string): void {
    this.db.prepare(`UPDATE lobe_shares SET accepted = 1 WHERE id = ?`).run(id);
  }

  revoke(id: string): void {
    this.db.prepare(`DELETE FROM lobe_shares WHERE id = ?`).run(id);
  }

  getShare(id: string): LobeShare | null {
    const row = this.db
      .prepare(`SELECT * FROM lobe_shares WHERE id = ?`)
      .get(id) as ShareRow | undefined;
    return row ? rowToShare(row) : null;
  }

  listIncoming(userId: string): LobeShare[] {
    const rows = this.db
      .prepare(`SELECT * FROM lobe_shares WHERE shared_with_user_id = ? ORDER BY created DESC`)
      .all(userId) as ShareRow[];
    return rows.map(rowToShare);
  }

  listOutgoing(userId: string): LobeShare[] {
    const rows = this.db
      .prepare(`SELECT * FROM lobe_shares WHERE owner_user_id = ? ORDER BY created DESC`)
      .all(userId) as ShareRow[];
    return rows.map(rowToShare);
  }

  listAcceptedForUser(userId: string): LobeShare[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM lobe_shares WHERE shared_with_user_id = ? AND accepted = 1 ORDER BY created DESC`,
      )
      .all(userId) as ShareRow[];
    return rows.map(rowToShare);
  }
}
