import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import type { NodeRecord, ApiKeyRecord } from '../../types/network';
import { spacesHome } from '@/lib/spaces-home';

const NETWORK_DB_PATH = path.join(spacesHome(), 'network.db');
const SECRET_PATH = path.join(spacesHome(), 'terminal_secret');

let _db: Database.Database | null = null;

export function getNetworkDb(): Database.Database {
  if (_db) return _db;

  const dir = path.dirname(NETWORK_DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(NETWORK_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      api_key_hint TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unknown',
      last_seen TEXT,
      last_error TEXT,
      session_count INTEGER DEFAULT 0,
      version TEXT,
      discovered_via TEXT DEFAULT 'manual',
      created TEXT DEFAULT (datetime('now')),
      updated TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL DEFAULT '',
      permissions TEXT NOT NULL DEFAULT 'read',
      last_used TEXT,
      created TEXT DEFAULT (datetime('now')),
      expires TEXT,
      username TEXT
    );
  `);

  try {
    db.exec('ALTER TABLE api_keys ADD COLUMN username TEXT');
  } catch {
    // Column already exists
  }

  _db = db;
  return db;
}

function getEncryptionKey(): Buffer {
  if (fs.existsSync(SECRET_PATH)) {
    return Buffer.from(fs.readFileSync(SECRET_PATH, 'utf-8').trim(), 'hex');
  }
  const secret = crypto.randomBytes(32);
  const dir = path.dirname(SECRET_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SECRET_PATH, secret.toString('hex'), { mode: 0o600 });
  return secret;
}

export function encryptApiKey(raw: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptApiKey(encrypted: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = encrypted.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted key format');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
}

function hashApiKey(raw: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(raw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyApiKeyHash(raw: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(raw, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
  } catch {
    return false;
  }
}

function toNodeRecord(row: any): NodeRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    apiKeyHint: row.api_key_hint,
    status: row.status,
    lastSeen: row.last_seen,
    lastError: row.last_error,
    sessionCount: row.session_count,
    version: row.version,
    discoveredVia: row.discovered_via,
    created: row.created,
    updated: row.updated,
  };
}

function toApiKeyRecord(row: any): ApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    permissions: row.permissions,
    lastUsed: row.last_used,
    created: row.created,
    expires: row.expires,
    username: row.username || null,
  };
}

export function addNode(opts: { id?: string; name: string; url: string; apiKey: string; discoveredVia?: string }): NodeRecord {
  const db = getNetworkDb();
  const id = opts.id || crypto.randomUUID();
  const encrypted = encryptApiKey(opts.apiKey);
  const hint = opts.apiKey.slice(-4);

  db.prepare(`
    INSERT INTO nodes (id, name, url, api_key_encrypted, api_key_hint, discovered_via)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, url=excluded.url,
      api_key_encrypted=excluded.api_key_encrypted,
      api_key_hint=excluded.api_key_hint,
      updated=datetime('now')
  `).run(id, opts.name, opts.url, encrypted, hint, opts.discoveredVia || 'manual');

  return getNode(id)!;
}

export function removeNode(nodeId: string): void {
  const db = getNetworkDb();
  db.prepare('DELETE FROM nodes WHERE id = ?').run(nodeId);
}

export function getNode(nodeId: string): NodeRecord | null {
  const db = getNetworkDb();
  const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId);
  return row ? toNodeRecord(row) : null;
}

export function listNodes(): NodeRecord[] {
  const db = getNetworkDb();
  return (db.prepare('SELECT * FROM nodes ORDER BY created').all() as any[]).map(toNodeRecord);
}

export function updateNodeStatus(nodeId: string, status: string, meta?: Partial<NodeRecord>): void {
  const db = getNetworkDb();
  const sets = ['status = ?', "updated = datetime('now')"];
  const vals: any[] = [status];

  if (status === 'online') {
    sets.push("last_seen = datetime('now')");
  }
  if (meta?.lastError !== undefined) {
    sets.push('last_error = ?');
    vals.push(meta.lastError);
  }
  if (meta?.sessionCount !== undefined) {
    sets.push('session_count = ?');
    vals.push(meta.sessionCount);
  }
  if (meta?.version !== undefined) {
    sets.push('version = ?');
    vals.push(meta.version);
  }
  if (meta?.name !== undefined) {
    sets.push('name = ?');
    vals.push(meta.name);
  }

  vals.push(nodeId);
  db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function updateNode(nodeId: string, data: { name?: string; url?: string }): void {
  const db = getNetworkDb();
  const sets: string[] = ["updated = datetime('now')"];
  const vals: any[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.url !== undefined) { sets.push('url = ?'); vals.push(data.url); }

  vals.push(nodeId);
  db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function getNodeApiKey(nodeId: string): string | null {
  const db = getNetworkDb();
  const row = db.prepare('SELECT api_key_encrypted FROM nodes WHERE id = ?').get(nodeId) as any;
  if (!row) return null;
  try {
    return decryptApiKey(row.api_key_encrypted);
  } catch {
    return null;
  }
}

export function createApiKey(name: string, permissions = 'read', username?: string): { rawKey: string; record: ApiKeyRecord } {
  const db = getNetworkDb();
  const id = crypto.randomUUID();
  const rawKey = `spk_${crypto.randomBytes(32).toString('hex')}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  db.prepare(`
    INSERT INTO api_keys (id, name, key_hash, key_prefix, permissions, username)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, keyHash, keyPrefix, permissions, username || null);

  const record = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
  return { rawKey, record: toApiKeyRecord(record) };
}

export function validateApiKey(rawKey: string): ApiKeyRecord | null {
  const db = getNetworkDb();
  // SECURITY (review M10): narrow candidates by key_prefix so we run the
  // memory-hard scrypt at most once per request, not once per stored key.
  // Previously every (even unauthenticated, shape-valid) request ran one scrypt
  // per key — a CPU/memory DoS lever on the single event loop. The OR '' clause
  // keeps any legacy rows created before key_prefix existed working.
  const prefix = rawKey.slice(0, 12);
  const keys = db.prepare("SELECT * FROM api_keys WHERE key_prefix = ? OR key_prefix = ''").all(prefix) as any[];

  for (const key of keys) {
    if (key.expires && new Date(key.expires) < new Date()) continue;

    if (verifyApiKeyHash(rawKey, key.key_hash)) {
      db.prepare("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?").run(key.id);
      return toApiKeyRecord(key);
    }
  }
  return null;
}

export function listApiKeys(username?: string): ApiKeyRecord[] {
  const db = getNetworkDb();
  if (username) {
    return (db.prepare('SELECT * FROM api_keys WHERE username = ? ORDER BY created').all(username) as any[]).map(toApiKeyRecord);
  }
  return (db.prepare('SELECT * FROM api_keys ORDER BY created').all() as any[]).map(toApiKeyRecord);
}

export function revokeApiKey(id: string): void {
  const db = getNetworkDb();
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
}

export function getDiscoveredNodes(): NodeRecord[] {
  const db = getNetworkDb();
  return (db.prepare(
    "SELECT * FROM nodes WHERE discovered_via = 'mdns' AND api_key_encrypted = '' ORDER BY created"
  ).all() as any[]).map(toNodeRecord);
}
