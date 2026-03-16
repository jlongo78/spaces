import Database from 'better-sqlite3';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface AuditEntry {
  requester_id: string;
  knowledge_id: string;
  action: 'allow' | 'deny';
  reason: string;
  /** ISO timestamp — defaults to now when omitted */
  timestamp?: string;
}

export interface AuditQueryFilter {
  requester_id?: string;
  knowledge_id?: string;
  action?: 'allow' | 'deny';
  /** Return only records at or after this ISO timestamp */
  since?: string;
}

export interface AuditRecord {
  id: number;
  requester_id: string;
  knowledge_id: string;
  action: string;
  reason: string;
  timestamp: string;
}

// ─── AuditLog ─────────────────────────────────────────────────────────────────

/**
 * Persistent audit trail for access decisions.
 * Uses a `better-sqlite3` database instance supplied by the caller so that
 * the table can be co-located with other application data or kept in a
 * dedicated :memory: / tmp database during tests.
 */
export class AuditLog {
  private readonly db: InstanceType<typeof Database>;

  constructor(db: InstanceType<typeof Database>) {
    this.db = db;
    this.createSchema();
  }

  // ─── Schema ─────────────────────────────────────────────────────────────────

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id  TEXT NOT NULL,
        knowledge_id  TEXT NOT NULL,
        action        TEXT NOT NULL,
        reason        TEXT NOT NULL,
        timestamp     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_requester
        ON audit_log (requester_id);

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp
        ON audit_log (timestamp);
    `);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Inserts one access-decision record into the audit log.
   */
  log(entry: AuditEntry): void {
    const timestamp = entry.timestamp ?? new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO audit_log (requester_id, knowledge_id, action, reason, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(entry.requester_id, entry.knowledge_id, entry.action, entry.reason, timestamp);
  }

  /**
   * Queries the audit log, applying any combination of optional filters.
   * Results are ordered by timestamp ascending.
   */
  query(filter: AuditQueryFilter = {}): AuditRecord[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filter.requester_id !== undefined) {
      conditions.push('requester_id = ?');
      params.push(filter.requester_id);
    }

    if (filter.knowledge_id !== undefined) {
      conditions.push('knowledge_id = ?');
      params.push(filter.knowledge_id);
    }

    if (filter.action !== undefined) {
      conditions.push('action = ?');
      params.push(filter.action);
    }

    if (filter.since !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM audit_log ${where} ORDER BY timestamp ASC`;

    return this.db.prepare(sql).all(...params) as AuditRecord[];
  }

  /**
   * Deletes all audit records older than `retentionDays` days.
   * Pass 0 to remove all records.
   */
  cleanup(retentionDays: number): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    const cutoffISO = cutoff.toISOString();

    this.db
      .prepare(`DELETE FROM audit_log WHERE timestamp < ?`)
      .run(cutoffISO);
  }
}
