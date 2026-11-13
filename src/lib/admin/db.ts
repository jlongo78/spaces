import { createRequire } from 'module';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spacesHome } from '@/lib/spaces-home';

const require_ = createRequire(__filename);
const Database: typeof import('better-sqlite3') = require_('better-sqlite3');

const ADMIN_DB_PATH = path.join(spacesHome(), 'admin.db');

let _db: ReturnType<typeof Database> | null = null;

export function getAdminDb(): ReturnType<typeof Database> {
  if (_db) return _db;

  const dir = path.dirname(ADMIN_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(ADMIN_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      shell_user TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      totp_secret TEXT,
      totp_enabled INTEGER DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 0,
      created TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS login_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS terminal_sessions (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      agent_type TEXT NOT NULL DEFAULT 'shell',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      duration_seconds INTEGER
    );

    -- review M8: server-side pending TOTP enrollment secret, so first-time
    -- enrollment verifies against a secret the SERVER generated rather than one
    -- echoed back by the client (which let an attacker enroll a chosen secret).
    CREATE TABLE IF NOT EXISTS totp_pending (
      username TEXT PRIMARY KEY,
      secret TEXT NOT NULL,
      created_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_login_events_username ON login_events(username);
    CREATE INDEX IF NOT EXISTS idx_login_events_timestamp ON login_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_terminal_sessions_username ON terminal_sessions(username);
    CREATE INDEX IF NOT EXISTS idx_terminal_sessions_started_at ON terminal_sessions(started_at);
  `);

  // Migration for DBs created before token_version existed (review M7).
  try { db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0'); } catch { /* column already exists */ }

  _db = db;
  return db;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}

export interface AdminUser {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  shell_user: string;
  role: string;
  totp_secret: string | null;
  totp_enabled: number;
  token_version: number;
  created: string;
}

export function createUser(data: {
  username: string;
  password: string;
  displayName: string;
  shellUser: string;
  role?: string;
}): AdminUser {
  const db = getAdminDb();
  const id = crypto.randomUUID();
  const passwordHash = hashPassword(data.password);

  db.prepare(`
    INSERT INTO users (id, username, password_hash, display_name, shell_user, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.username, passwordHash, data.displayName, data.shellUser, data.role || 'user');

  return getUser(data.username)!;
}

export function getUser(username: string): AdminUser | null {
  const db = getAdminDb();
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as AdminUser | null;
}

export function getUserById(id: string): AdminUser | null {
  const db = getAdminDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as AdminUser | null;
}

export function listUsers(): AdminUser[] {
  const db = getAdminDb();
  return db.prepare('SELECT * FROM users ORDER BY created').all() as AdminUser[];
}

export function updateUser(id: string, data: {
  displayName?: string;
  shellUser?: string;
  role?: string;
  password?: string;
  totpSecret?: string | null;
  totpEnabled?: boolean;
}): void {
  const db = getAdminDb();
  const sets: string[] = [];
  const vals: any[] = [];

  if (data.displayName !== undefined) { sets.push('display_name = ?'); vals.push(data.displayName); }
  if (data.shellUser !== undefined) { sets.push('shell_user = ?'); vals.push(data.shellUser); }
  if (data.role !== undefined) { sets.push('role = ?'); vals.push(data.role); }
  if (data.password !== undefined) { sets.push('password_hash = ?'); vals.push(hashPassword(data.password)); }
  if (data.totpSecret !== undefined) { sets.push('totp_secret = ?'); vals.push(data.totpSecret); }
  if (data.totpEnabled !== undefined) { sets.push('totp_enabled = ?'); vals.push(data.totpEnabled ? 1 : 0); }

  // review M7: a role or password change invalidates outstanding session
  // tokens by bumping the token version (checked by the Node-side guards).
  if (data.role !== undefined || data.password !== undefined) {
    sets.push('token_version = token_version + 1');
  }

  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  _shellUserCache.clear();
}

/** Current session token version for a user (review M7). 0 if unknown. */
export function getTokenVersion(username: string): number {
  const db = getAdminDb();
  const row = db.prepare('SELECT token_version FROM users WHERE username = ?').get(username) as
    | { token_version: number }
    | undefined;
  return row?.token_version ?? 0;
}

/** Invalidate all outstanding session tokens for a user (logout-everywhere). */
export function bumpTokenVersion(username: string): void {
  const db = getAdminDb();
  db.prepare('UPDATE users SET token_version = token_version + 1 WHERE username = ?').run(username);
}

export function deleteUser(id: string): void {
  const db = getAdminDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  _shellUserCache.clear();
}

interface CacheEntry {
  shellUser: string;
  expires: number;
}

const _shellUserCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60_000;

export function resolveShellUser(appUsername: string): string {
  const cached = _shellUserCache.get(appUsername);
  if (cached && cached.expires > Date.now()) {
    return cached.shellUser;
  }

  const user = getUser(appUsername);
  const shellUser = user?.shell_user || appUsername;

  _shellUserCache.set(appUsername, { shellUser, expires: Date.now() + CACHE_TTL });
  return shellUser;
}

// ─── Pending TOTP enrollment (review M8) ──────────────────────
const TOTP_PENDING_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function setPendingTotp(username: string, secret: string, nowMs: number = Date.now()): void {
  const db = getAdminDb();
  db.prepare(
    `INSERT INTO totp_pending (username, secret, created_ms) VALUES (?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET secret = excluded.secret, created_ms = excluded.created_ms`
  ).run(username, secret, nowMs);
}

/** Returns the pending secret if present and not expired, else null. */
export function getPendingTotp(username: string, nowMs: number = Date.now()): string | null {
  const db = getAdminDb();
  const row = db.prepare('SELECT secret, created_ms FROM totp_pending WHERE username = ?').get(username) as
    | { secret: string; created_ms: number }
    | undefined;
  if (!row) return null;
  if (nowMs - row.created_ms > TOTP_PENDING_TTL_MS) {
    clearPendingTotp(username);
    return null;
  }
  return row.secret;
}

export function clearPendingTotp(username: string): void {
  const db = getAdminDb();
  db.prepare('DELETE FROM totp_pending WHERE username = ?').run(username);
}

export function recordLogin(username: string, ip?: string, userAgent?: string): void {
  const db = getAdminDb();
  db.prepare(
    'INSERT INTO login_events (username, ip_address, user_agent) VALUES (?, ?, ?)'
  ).run(username, ip || null, userAgent || null);
}

export function recordSessionStart(id: string, username: string, agentType: string): void {
  const db = getAdminDb();
  db.prepare(
    'INSERT OR REPLACE INTO terminal_sessions (id, username, agent_type) VALUES (?, ?, ?)'
  ).run(id, username, agentType);
}

export function recordSessionEnd(id: string): void {
  const db = getAdminDb();
  db.prepare(`
    UPDATE terminal_sessions
    SET ended_at = datetime('now'),
        duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
    WHERE id = ? AND ended_at IS NULL
  `).run(id);
}

export function getLoginEvents(days: number): any[] {
  const db = getAdminDb();
  return db.prepare(`
    SELECT username, timestamp, ip_address, user_agent
    FROM login_events
    WHERE timestamp >= datetime('now', ?)
    ORDER BY timestamp DESC
  `).all(`-${days} days`);
}

export function getTerminalSessions(days: number): any[] {
  const db = getAdminDb();
  return db.prepare(`
    SELECT id, username, agent_type, started_at, ended_at, duration_seconds
    FROM terminal_sessions
    WHERE started_at >= datetime('now', ?)
    ORDER BY started_at DESC
  `).all(`-${days} days`);
}

export function getActiveSessionCount(): number {
  const db = getAdminDb();
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM terminal_sessions WHERE ended_at IS NULL'
  ).get() as { count: number };
  return row.count;
}

export function getDailyLoginCounts(days: number): any[] {
  const db = getAdminDb();
  return db.prepare(`
    SELECT date(timestamp) as date, COUNT(*) as count
    FROM login_events
    WHERE timestamp >= datetime('now', ?)
    GROUP BY date(timestamp)
    ORDER BY date
  `).all(`-${days} days`);
}

export function getDailySessionMinutes(days: number): any[] {
  const db = getAdminDb();
  return db.prepare(`
    SELECT date(started_at) as date,
           CAST(SUM(COALESCE(duration_seconds, 0)) / 60.0 AS REAL) as minutes
    FROM terminal_sessions
    WHERE started_at >= datetime('now', ?)
    GROUP BY date(started_at)
    ORDER BY date
  `).all(`-${days} days`);
}

export function getUserSessionSummary(days: number): any[] {
  const db = getAdminDb();
  return db.prepare(`
    SELECT
      ts.username,
      COUNT(ts.id) as session_count,
      CAST(SUM(COALESCE(ts.duration_seconds, 0)) / 60.0 AS REAL) as total_minutes,
      MAX(le.last_login) as last_login
    FROM terminal_sessions ts
    LEFT JOIN (
      SELECT username, MAX(timestamp) as last_login
      FROM login_events
      GROUP BY username
    ) le ON ts.username = le.username
    WHERE ts.started_at >= datetime('now', ?)
    GROUP BY ts.username
    ORDER BY total_minutes DESC
  `).all(`-${days} days`);
}
