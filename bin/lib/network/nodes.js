/**
 * The peer table in `~/.spaces/network.db`, and the encryption over it.
 *
 * This exists because the same table, the same AES-256-GCM scheme and the same
 * `~/.spaces/terminal_secret` were already implemented twice — in
 * `src/lib/network/db.ts` for the Next app, and privately inside
 * `bin/terminal-server.js`. The runtime needs them too, and a third copy would
 * guarantee drift. `terminal-server.js` delegates here; the TS module stays,
 * because it runs in a different process and bridging it is not worth it.
 *
 * `network.db` is deliberately separate from `spaces.db`: peers and their
 * credentials are machine configuration, not session state, and they must not
 * travel with a copied workspace database.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spacesHome } = require('../spaces-home');

const SPACES_DIR = spacesHome();
const DEFAULT_DB_PATH = path.join(SPACES_DIR, 'network.db');
const SECRET_PATH = path.join(SPACES_DIR, 'terminal_secret');

/** Columns added after the table shipped. See `ensureSchema`. */
const ADDED_COLUMNS = {
  public_key: 'TEXT',
  cert_fingerprint: 'TEXT',
};

function getEncryptionKey() {
  if (fs.existsSync(SECRET_PATH)) {
    return Buffer.from(fs.readFileSync(SECRET_PATH, 'utf-8').trim(), 'hex');
  }
  const secret = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret.toString('hex'), { mode: 0o600 });
  return secret;
}

/**
 * `iv:tag:data`, all base64 — byte-compatible with `encryptApiKey` in
 * `src/lib/network/db.ts:79`. Both sides read the same secret file, so a value
 * written by either must decrypt with the other.
 */
function encryptApiKey(raw) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Returns `null` for anything that will not decrypt, rather than throwing.
 *
 * The value comes off disk and may have been written under a secret that has
 * since been regenerated; a node that cannot be decrypted is a node that
 * cannot be used, which is a state the caller must handle anyway.
 */
function decryptApiKey(encrypted) {
  if (!encrypted) return null;
  try {
    const key = getEncryptionKey();
    const [ivB64, tagB64, dataB64] = String(encrypted).split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * Creates the table if absent, and adds any column this build knows about that
 * an older database lacks.
 *
 * `PRAGMA table_info` first, `ALTER TABLE` only for what is missing. Selecting
 * a column that does not exist throws, and the historic swallow-the-error
 * habit around these tables turns that into "you have no peers" rather than an
 * error — the exact shape of the `panes.color` regression.
 */
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL DEFAULT '',
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
  `);
  const present = new Set(db.prepare('PRAGMA table_info(nodes)').all().map((c) => c.name));
  for (const [column, type] of Object.entries(ADDED_COLUMNS)) {
    if (!present.has(column)) {
      db.exec(`ALTER TABLE nodes ADD COLUMN ${column} ${type}`);
    }
  }
}

function openNodeDb({ path: dbPath = DEFAULT_DB_PATH } = {}) {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  ensureSchema(db);
  return db;
}

function listNodes(db) {
  return db.prepare('SELECT * FROM nodes ORDER BY created').all();
}

function getNode(db, id) {
  return db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) || null;
}

/**
 * Records a peer as paired: its public key (the trust anchor every later
 * handshake verifies against) and its API key, encrypted.
 *
 * Upserts, and an upsert **replaces** the public key rather than preserving the
 * existing one. Re-pairing is how a rotated key is adopted, and a superseded
 * key that kept working would defeat the point of rotating it.
 */
function pairNode(db, { id, name, url, publicKey = null, apiKey = '', discoveredVia = 'manual' }) {
  const encrypted = apiKey ? encryptApiKey(apiKey) : '';
  // A hint is for telling two keys apart in a list, so it must not be enough
  // to reconstruct one: last four characters only.
  const hint = apiKey ? `…${String(apiKey).slice(-4)}` : '';
  db.prepare(
    `INSERT INTO nodes (id, name, url, api_key_encrypted, api_key_hint, public_key, discovered_via, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown')
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       url = excluded.url,
       api_key_encrypted = excluded.api_key_encrypted,
       api_key_hint = excluded.api_key_hint,
       public_key = excluded.public_key,
       updated = datetime('now')`
  ).run(id, name, url, encrypted, hint, publicKey, discoveredVia);
  return getNode(db, id);
}

/** Pins the certificate fingerprint observed when this peer was paired. */
function setFingerprint(db, id, fingerprint) {
  db.prepare("UPDATE nodes SET cert_fingerprint = ?, updated = datetime('now') WHERE id = ?").run(
    fingerprint,
    id
  );
  return getNode(db, id);
}

/** `true` if a row was removed. */
function forgetNode(db, id) {
  return db.prepare('DELETE FROM nodes WHERE id = ?').run(id).changes > 0;
}

/**
 * Peers this machine knows of but cannot authenticate.
 *
 * "Paired" means **a public key is recorded**, not that an API key is. Those
 * are different things and conflating them would be a security bug rather than
 * a cosmetic one: rows written by the older federation path carry an API key
 * and no keypair, and treating them as paired would let a machine be counted
 * as trusted when nothing can verify it. The keypair is the trust anchor now,
 * so it is the only thing that decides this.
 *
 * A consequence worth knowing: machines paired under the old scheme appear
 * here and must be paired again. That is correct — an API key was never
 * something they could prove they held.
 *
 * Discovery is separately not trust: `bin/mdns-service.js` inserts whatever
 * answers on the LAN, and mDNS is trivially spoofable. These rows exist so the
 * UI can offer them, never so they can be connected to.
 */
function listUnpaired(db) {
  return db
    .prepare('SELECT * FROM nodes WHERE public_key IS NULL OR public_key = ? ORDER BY created')
    .all('');
}

/** The decrypted API key for a peer, or `null` if absent or unreadable. */
function getNodeApiKey(db, id) {
  const row = getNode(db, id);
  return row ? decryptApiKey(row.api_key_encrypted) : null;
}

module.exports = {
  openNodeDb,
  ensureSchema,
  listNodes,
  getNode,
  pairNode,
  forgetNode,
  listUnpaired,
  setFingerprint,
  getNodeApiKey,
  encryptApiKey,
  decryptApiKey,
  DEFAULT_DB_PATH,
};
