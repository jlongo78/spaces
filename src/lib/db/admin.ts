import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const ADMIN_DB_PATH = path.join(os.homedir(), '.spaces', 'admin.db');

let _db: Database.Database | null = null;

export function getAdminDb(): Database.Database {
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
      created TEXT DEFAULT (datetime('now'))
    );
  `);

  _db = db;
  return db;
}

// ─── Password Hashing ──────────────────────────────────────

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

// ─── User CRUD ─────────────────────────────────────────────

export interface AdminUser {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  shell_user: string;
  role: string;
  totp_secret: string | null;
  totp_enabled: number;
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

  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  // Invalidate shell user cache
  _shellUserCache.clear();
}

export function deleteUser(id: string): void {
  const db = getAdminDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  _shellUserCache.clear();
}

// ─── Shell User Resolution (cached) ────────────────────────

interface CacheEntry {
  shellUser: string;
  expires: number;
}

const _shellUserCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60_000; // 60 seconds

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
