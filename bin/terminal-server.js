#!/usr/bin/env node

const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const desktopAuth = require('./lib/desktop-auth');
const { isLoopback } = require('./lib/net-trust');
const { isValidShellUser, userKeyPath, userKeyPubPath } = require('./lib/user-keys');
const { createRuntime } = require('./lib/runtime');
const { attachControlChannel } = require('./lib/runtime/control-channel');
const { attachPaneSocket } = require('./lib/runtime/pane-socket');
const { spawnPane, AGENTS, buildPaneEnv } = require('./lib/runtime/spawn-pane');
const { spacesHome } = require('./lib/spaces-home');

const PORT = parseInt(process.env.SPACES_WS_PORT || '3458', 10);
const IS_MULTIUSER = process.env.SPACES_MULTIUSER === '1';

// ─── Runtime-core singleton ─────────────────────────────────
// Lazily created on first use so tests that only need the legacy /ws path
// (and never touch /proto) don't pay for it.
/**
 * The identity and peer database federation needs to relay a pane, installed
 * by `bin/spaces.js` when `--federate` is given.
 *
 * Null on a machine that never federates, which is what the pane route reports
 * rather than failing in a way that looks like a missing pane.
 */
let _federation = null;
function setFederationContext(ctx) { _federation = ctx; }
function getFederationContext() { return _federation; }

let _runtime = null;
function getRuntime() {
  if (!_runtime) {
    _runtime = createRuntime({
      nodeId: os.hostname(),
      spacesDbPath: path.join(spacesHome(), 'spaces.db'),
      // A getter, not the current value: API_PORT is a `let` that attached
      // mode updates after the HTTP server starts listening, and this
      // runtime can be created before that happens.
      getApiPort: () => API_PORT,
      // The web app writes this database from another process.
      watchDb: true,
      trackGit: true,
      trackClaudeSessions: true,
    });
  }
  return _runtime;
}
// API_PORT is the port where Next.js API routes are reachable.
// In attached mode, createTerminalServer() updates this to the parent server's port.
let API_PORT = parseInt(process.env.SPACES_PORT || '3457', 10);

// Track whether the Next.js API is ready — avoids timeout spam during startup
let _apiReady = false;
function setApiReady() { _apiReady = true; }
function isApiReady() { return _apiReady; }
// Poll until the API responds, then mark ready.
//
// One retry per probe, whichever way the probe ends. A probe that times out
// is destroyed, and a destroyed request reports an error as well; retrying
// on both doubled the probes every round, and on a loaded host whose API
// missed the first one the server had a million requests in flight to
// itself within a minute and ran out of memory.
function waitForApi(get = http.get) {
  const check = () => {
    let retried = false;
    const retry = () => {
      if (retried) return;
      retried = true;
      setTimeout(check, 2000);
    };
    const req = get(`http://localhost:${API_PORT}/api/tier`, { timeout: 1000 }, (res) => {
      res.resume(); // consume body to free socket
      if (res.statusCode < 500) { setApiReady(); return; }
      retry();
    });
    req.on('error', retry);
    req.on('timeout', () => { req.destroy(); retry(); });
  };
  setTimeout(check, 1000);
}

// ─── Terminal token verification ──────────────────────────

const SECRET_PATH = path.join(spacesHome(), 'terminal_secret');

function getTerminalSecret() {
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

let _terminalSecret = null;
function terminalSecret() {
  if (!_terminalSecret) {
    _terminalSecret = getTerminalSecret();
  }
  return _terminalSecret;
}

function verifyTerminalToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', terminalSecret())
    .update(payloadB64)
    .digest('base64url');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload.sub || null;
  } catch {
    return null;
  }
}

// ─── Session token verification (for self-contained auth) ──

const SESSION_SECRET_PATH = path.join(spacesHome(), 'session_secret');

function getSessionSecret() {
  if (fs.existsSync(SESSION_SECRET_PATH)) {
    return Buffer.from(fs.readFileSync(SESSION_SECRET_PATH, 'utf-8').trim(), 'hex');
  }
  return null;
}

let _sessionSecret = null;
function sessionSecret() {
  if (!_sessionSecret) {
    _sessionSecret = getSessionSecret();
  }
  return _sessionSecret;
}

function verifySessionToken(token) {
  const secret = sessionSecret();
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret)
    .update(payloadB64)
    .digest('base64url');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { sub: payload.sub, role: payload.role || 'user' };
  } catch {
    return null;
  }
}

// ─── Admin DB for shell user lookup ─────────────────────────

const ADMIN_DB_PATH = path.join(spacesHome(), 'admin.db');
let _adminDb = null;

function getAdminDb() {
  if (_adminDb) return _adminDb;
  if (!fs.existsSync(ADMIN_DB_PATH)) return null;
  try {
    const Database = require('better-sqlite3');
    _adminDb = new Database(ADMIN_DB_PATH, { readonly: true });
    return _adminDb;
  } catch {
    return null;
  }
}

function lookupShellUser(appUsername) {
  const db = getAdminDb();
  if (!db) return appUsername;
  try {
    const row = db.prepare('SELECT shell_user FROM users WHERE username = ?').get(appUsername);
    return row ? row.shell_user : appUsername;
  } catch {
    return appUsername;
  }
}

// ─── Network DB for federation ───────────────────────────────

const NETWORK_DB_PATH = path.join(spacesHome(), 'network.db');
let _networkDb = null;

function getNetworkDb() {
  if (_networkDb) return _networkDb;
  if (!fs.existsSync(NETWORK_DB_PATH)) return null;
  try {
    const Database = require('better-sqlite3');
    _networkDb = new Database(NETWORK_DB_PATH, { readonly: true });
    return _networkDb;
  } catch {
    return null;
  }
}

function validateNetworkApiKey(rawKey) {
  const db = getNetworkDb();
  if (!db || !rawKey || !rawKey.startsWith('spk_')) return null;
  try {
    const keys = db.prepare('SELECT * FROM api_keys').all();
    for (const key of keys) {
      if (key.expires && new Date(key.expires) < new Date()) continue;
      const [salt, hash] = key.key_hash.split(':');
      if (!salt || !hash) continue;
      const derived = crypto.scryptSync(rawKey, salt, 64).toString('hex');
      try {
        if (crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'))) {
          return key;
        }
      } catch { continue; }
    }
  } catch { /* ignore */ }
  return null;
}

// The peer table and its encryption now live in one place — ./lib/network/nodes
// — because this file, src/lib/network/db.ts and (as of federation) the runtime
// all need them, and three copies of an AES-GCM scheme over one secret file is
// three chances to drift apart. These two stay as named delegations rather than
// being inlined at their call sites: `handleProxyConnection` reads better for
// saying what it wants than for saying where it comes from.
const nodeStore = require('./lib/network/nodes');

function getNodeInfo(nodeId) {
  const db = getNetworkDb();
  if (!db) return null;
  try {
    return nodeStore.getNode(db, nodeId);
  } catch {
    return null;
  }
}

function decryptNodeApiKey(encrypted) {
  return nodeStore.decryptApiKey(encrypted);
}

// ─── Writable Admin DB for analytics ─────────────────────────

let _adminDbRW = null;

function getAdminDbRW() {
  if (_adminDbRW) return _adminDbRW;
  try {
    const Database = require('better-sqlite3');
    const dir = path.dirname(ADMIN_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const db = new Database(ADMIN_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_login_events_username ON login_events(username);
      CREATE INDEX IF NOT EXISTS idx_login_events_timestamp ON login_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_terminal_sessions_username ON terminal_sessions(username);
      CREATE INDEX IF NOT EXISTS idx_terminal_sessions_started_at ON terminal_sessions(started_at);
    `);
    // Clean up stale sessions from previous crashes
    db.prepare(`
      UPDATE terminal_sessions
      SET ended_at = datetime('now'),
          duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
      WHERE ended_at IS NULL
    `).run();
    _adminDbRW = db;
    console.log('[Analytics] Writable admin DB connected, stale sessions cleaned up');
    return db;
  } catch (err) {
    console.error('[Analytics] Failed to open writable admin DB:', err.message);
    return null;
  }
}

function analyticsRecordSessionStart(paneId, username, agentType) {
  try {
    const db = getAdminDbRW();
    if (!db) return;
    db.prepare(
      'INSERT OR REPLACE INTO terminal_sessions (id, username, agent_type) VALUES (?, ?, ?)'
    ).run(paneId, username, agentType);
  } catch (err) {
    console.error('[Analytics] recordSessionStart error:', err.message);
  }
}

function analyticsRecordSessionEnd(paneId) {
  try {
    const db = getAdminDbRW();
    if (!db) return;
    db.prepare(`
      UPDATE terminal_sessions
      SET ended_at = datetime('now'),
          duration_seconds = CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
      WHERE id = ? AND ended_at IS NULL
    `).run(paneId);
  } catch (err) {
    console.error('[Analytics] recordSessionEnd error:', err.message);
  }
}

// ─── Cookie parser ──────────────────────────────────────────

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(part => {
    const [key, ...rest] = part.trim().split('=');
    if (key) cookies[key] = rest.join('=');
  });
  return cookies;
}

// ─── Runtime-core workspace-id normalization ─────────────────
// runtime.snapshot() maps DB workspaces to `w${id}` (e.g. "w3"), but
// SPACES_WORKSPACE_ID is set from the raw DB id ("3") by the collab-config
// lookup elsewhere in this file. Passing the bare digit
// straight into registerPane would create a duplicate nameless stub
// workspace ("3") beside the real one ("w3") once snapshot() backfills it —
// normalize at this boundary instead of teaching the runtime about the DB's
// id format.
function normalizeRuntimeWorkspaceId(raw) {
  if (!raw) return null;
  const s = String(raw);
  return /^\d+$/.test(s) ? `w${s}` : s;
}

// ─── /proto auth gate ────────────────────────────────────────
// Desktop-mode authentication; see bin/lib/desktop-auth.js for the scheme.
function checkProtoAuth(req) {
  // Multiuser mode never gets here (both /proto routes are refused above),
  // so this is desktop mode, which answers its owner and nobody else. Being
  // on the loopback interface proves nothing: every account on the machine
  // shares it. See bin/lib/desktop-auth.js.
  return isDesktopOwner(req);
}

/**
 * True when `req` carries the owner's credentials: the secret itself or a
 * session token signed with it (`Authorization: Bearer` or
 * `x-spaces-internal`), or the browser's session cookie. Never a query
 * string, and never a multiuser credential — a session cookie or terminal
 * token issued to some other account while the server ran in multiuser
 * mode must not open the owner's desktop.
 */
function isDesktopOwner(req) {
  const secret = process.env.SPACES_INTERNAL_TOKEN || '';
  if (!secret) return false;
  if (desktopAuth.isOwnerCredential(secret, desktopAuth.presentedSecret(req.headers))) return true;
  // The cookie alone counts only from Spaces' own pages. Every port on
  // localhost is the same site, so the browser also attaches it to sockets
  // a page from another local port opens; the Origin tells them apart.
  const origin = req.headers.origin;
  if (origin && !desktopAuth.originIsSelf(origin, req.headers.host)) return false;
  const cookie = parseCookies(req.headers.cookie)[desktopAuth.DESKTOP_COOKIE];
  return !!(cookie && desktopAuth.verifyDesktop(secret, cookie, 'session'));
}

/** Hostnames the operator allows besides the loopback ones. */
function allowedHosts() {
  return String(process.env.SPACES_ALLOWED_ORIGINS || '')
    .split(',').map((h) => h.trim()).filter(Boolean);
}

// ─── SSH service key path (used to spawn shells as other OS users) ──

const SERVICE_KEY = path.join(spacesHome(), 'service_key');

// Ensure the SSH service key exists, has correct permissions, and is authorized.
function ensureServiceKeyAtRuntime() {
  const { spawnSync } = require('child_process');
  const currentUser = os.userInfo().username;
  const isWindows = process.platform === 'win32';

  // Generate key if missing (all platforms)
  if (!fs.existsSync(SERVICE_KEY)) {
    const dir = path.dirname(SERVICE_KEY);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const result = spawnSync('ssh-keygen', [
      '-t', 'ed25519', '-f', SERVICE_KEY, '-N', '', '-C', 'spaces-service-key',
    ], { stdio: 'pipe', timeout: 10000 });
    if (result.status !== 0) {
      console.error('[SSH] Failed to generate service key');
      return;
    }
    if (isWindows) {
      // Lock down permissions: only the process owner + SYSTEM
      spawnSync('icacls', [SERVICE_KEY, '/inheritance:r',
        '/remove', 'BUILTIN\\Administrators', '/remove', 'BUILTIN\\Users', '/remove', 'Everyone',
        '/grant:r', currentUser + ':(F)',
        '/grant', 'NT AUTHORITY\\SYSTEM:(F)'], { stdio: 'pipe', timeout: 5000 });
    } else {
      spawnSync('chmod', ['600', SERVICE_KEY], { stdio: 'pipe', timeout: 5000 });
    }
    console.log('[SSH] Generated service key as ' + currentUser);
  }

  // Always ensure the public key is authorized
  if (!fs.existsSync(SERVICE_KEY + '.pub')) return;
  const pubKey = fs.readFileSync(SERVICE_KEY + '.pub', 'utf-8').trim();

  if (isWindows) {
    // Authorize in administrators_authorized_keys (for admin shell users)
    try {
      const adminAuthKeys = path.join(process.env.ProgramData || 'C:\\ProgramData', 'ssh', 'administrators_authorized_keys');
      const authDir = path.dirname(adminAuthKeys);
      if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
      spawnSync('icacls', [adminAuthKeys, '/inheritance:r',
        '/grant:r', 'SYSTEM:(F)', '/grant', 'Administrators:(R)'], { stdio: 'pipe', timeout: 5000 });
      let existing = '';
      try { existing = fs.readFileSync(adminAuthKeys, 'utf-8'); } catch {}
      if (!existing.includes(pubKey)) {
        fs.appendFileSync(adminAuthKeys, pubKey + String.fromCharCode(10));
        console.log('[SSH] Authorized service key in administrators_authorized_keys');
      }
    } catch (e) {
      console.error('[SSH] Could not authorize admin key (non-fatal):', e.message);
    }

    // Authorize in each shell user's ~/.ssh/authorized_keys (for non-admin users)
    try {
      const usersDir = path.dirname(os.homedir());
      const skip = new Set(['Public', 'Default', 'Default User', 'All Users']);
      const profiles = fs.readdirSync(usersDir)
        .filter(name => !skip.has(name) && !name.startsWith('.'))
        .filter(name => fs.existsSync(path.join(usersDir, name, '.claude')));
      for (const username of profiles) {
        try {
          const sshDir = path.join(usersDir, username, '.ssh');
          if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true });
          const authKeysPath = path.join(sshDir, 'authorized_keys');
          let existing = '';
          try { existing = fs.readFileSync(authKeysPath, 'utf-8'); } catch {}
          if (!existing.includes(pubKey)) {
            fs.appendFileSync(authKeysPath, pubKey + String.fromCharCode(10));
            spawnSync('icacls', [authKeysPath, '/inheritance:r',
              '/grant:r', username + ':(F)',
              '/grant', 'NT AUTHORITY\\SYSTEM:(F)'], { stdio: 'pipe', timeout: 5000 });
            console.log('[SSH] Authorized service key for user ' + username);
          }
        } catch (e) {
          console.error('[SSH] Could not authorize key for ' + username + ' (non-fatal):', e.message);
        }
      }
    } catch (e) {
      console.error('[SSH] Could not scan user profiles (non-fatal):', e.message);
    }
  } else {
    // Linux/macOS: authorize all shell users from admin DB as a fallback
    // (AuthorizedKeysCommand is the primary mechanism, this is belt-and-suspenders)
    const db = getAdminDb();
    if (db) {
      try {
        const users = db.prepare('SELECT DISTINCT shell_user FROM users').all();
        for (const row of users) {
          const shellUser = row.shell_user;
          try {
            authorizeShellUser(shellUser, pubKey);
          } catch (e) {
            console.error('[SSH] Could not authorize key for ' + shellUser + ' (non-fatal):', e.message);
          }
        }
      } catch (e) {
        console.error('[SSH] Could not query admin DB for shell users (non-fatal):', e.message);
      }
    }
  }
}

// Authorize the service key for a Linux/macOS shell user
function authorizeShellUser(shellUser, pubKey) {
  const { spawnSync } = require('child_process');

  // Resolve home directory
  let userHome;
  try {
    const result = spawnSync('getent', ['passwd', shellUser], { encoding: 'utf-8', timeout: 5000 });
    const fields = (result.stdout || '').split(':');
    userHome = fields[5];
  } catch {}
  if (!userHome) {
    userHome = process.platform === 'darwin' ? `/Users/${shellUser}` : `/home/${shellUser}`;
  }
  if (!fs.existsSync(userHome)) return;

  const sshDir = path.join(userHome, '.ssh');
  const authKeysPath = path.join(sshDir, 'authorized_keys');

  // Check if already authorized
  let existing = '';
  try { existing = fs.readFileSync(authKeysPath, 'utf-8'); } catch {}
  if (existing.includes(pubKey)) return;

  // Create .ssh dir with correct ownership
  if (!fs.existsSync(sshDir)) {
    spawnSync('sudo', ['mkdir', '-p', sshDir], { stdio: 'pipe', timeout: 5000 });
    spawnSync('sudo', ['chmod', '700', sshDir], { stdio: 'pipe', timeout: 5000 });
    spawnSync('sudo', ['chown', `${shellUser}:${shellUser}`, sshDir], { stdio: 'pipe', timeout: 5000 });
  }

  // Append key and fix permissions. SECURITY (review M9): stage through a
  // private 0700 temp dir (mkdtempSync) with a 0600 file rather than a
  // predictable /tmp/spaces-authkey-<user>-<ts> path in the world-writable /tmp,
  // which a local attacker could pre-create as a symlink and have the
  // subsequent privileged `sudo cp` redirect (insecure-temp / TOCTOU).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-authkey-'));
  const tmpFile = path.join(tmpDir, 'authorized_keys');
  fs.writeFileSync(tmpFile, existing + pubKey + '\n', { mode: 0o600 });
  spawnSync('sudo', ['cp', tmpFile, authKeysPath], { stdio: 'pipe', timeout: 5000 });
  spawnSync('sudo', ['chmod', '600', authKeysPath], { stdio: 'pipe', timeout: 5000 });
  spawnSync('sudo', ['chown', `${shellUser}:${shellUser}`, authKeysPath], { stdio: 'pipe', timeout: 5000 });
  try { fs.unlinkSync(tmpFile); fs.rmdirSync(tmpDir); } catch {}

  console.log('[SSH] Authorized service key for user ' + shellUser);
}

// Ensure a PER-USER SSH keypair exists and is authorized for this shell user,
// returning the private key path — or null to fall back to the shared service
// key (review M1). One key per user means compromising one user's key does not
// grant access as every other user. Linux/macOS only for now; on Windows we
// keep the shared key (Windows desktop never SSHes as another user, and the
// key is icacls-locked). Fails closed to null so any problem here degrades to
// the previous shared-key behaviour rather than breaking terminals.
function ensurePerUserKey(shellUser) {
  try {
    if (process.platform === 'win32') return null;
    if (!isValidShellUser(shellUser)) return null;
    const { spawnSync } = require('child_process');
    const spacesDir = path.dirname(SERVICE_KEY);
    const keyPath = userKeyPath(spacesDir, shellUser);
    const pubPath = userKeyPubPath(spacesDir, shellUser);
    if (!keyPath || !pubPath) return null;
    if (!fs.existsSync(keyPath)) {
      const keysDir = path.join(spacesDir, 'keys');
      if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir, { recursive: true, mode: 0o700 });
      const r = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', keyPath, '-N', '', '-C', `spaces-${shellUser}`], { stdio: 'pipe', timeout: 10000 });
      if (r.status !== 0 || !fs.existsSync(keyPath)) return null;
      spawnSync('chmod', ['600', keyPath], { stdio: 'pipe', timeout: 5000 });
    }
    // Authorize THIS user's public key for THIS user only.
    const pub = fs.readFileSync(pubPath, 'utf-8').trim();
    authorizeShellUser(shellUser, pub);
    return keyPath;
  } catch (e) {
    console.error(`[SSH] Per-user key setup for ${shellUser} failed (non-fatal, using shared key):`, e.message);
    return null;
  }
}

// The service key lets the server open shells as other OS users, which only
// multiuser mode does. It is passwordless and authorized for login, so it is
// created and authorized only there — never in desktop mode, where the owner
// is the only user and nothing should quietly grant itself SSH access.
if (IS_MULTIUSER) {
  try { ensureServiceKeyAtRuntime(); } catch (e) { console.error('[SSH] Key setup failed (non-fatal):', e.message); }
}

// Session store: keeps ptys alive across WebSocket reconnections
// Key: paneId, Value: { pty, ws (current WebSocket or null), buffer (rolling output), username }
const sessions = new Map();

const MAX_BUFFER_LINES = 500;

// Agent definitions (mirrors src/lib/agents.ts) now live in
// ./lib/runtime/spawn-pane, shared with the /proto pane.create path —
// imported above. Every existing AGENTS[...] reference below keeps working
// unchanged.

const SESSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-_.]*$/;

// ─── Git Bash detection (Windows) ────────────────────────
function findGitBash() {
  const custom = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (custom && fs.existsSync(custom)) return custom;
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  // Last resort: check if bash is on PATH via where command
  try {
    const result = require('child_process').execSync('where bash.exe 2>nul', { encoding: 'utf-8', timeout: 3000, windowsHide: true });
    const first = result.trim().split('\n')[0].trim();
    if (first && first.toLowerCase().includes('git') && fs.existsSync(first)) return first;
  } catch { /* not found */ }
  return null;
}

// ─── SSH binary detection (Windows) ──────────────────────
function findSshBinary() {
  if (process.platform !== 'win32') return '/usr/bin/ssh';
  // Windows OpenSSH ships in System32
  const sysSSH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
  if (fs.existsSync(sysSSH)) return sysSSH;
  // Git for Windows also bundles ssh
  const gitSSH = 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
  if (fs.existsSync(gitSSH)) return gitSSH;
  try {
    const result = require('child_process').execSync('where ssh.exe 2>nul', { encoding: 'utf-8', timeout: 3000, windowsHide: true });
    const first = result.trim().split(String.fromCharCode(10))[0].trim();
    if (first && fs.existsSync(first)) return first;
  } catch {}
  return null;
}

// ─── Origin validation ───────────────────────────────────
function isAllowedOrigin(origin, req) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    // Allow localhost/127.0.0.1 (any port)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
    // Allow if origin matches the server's own Host header (same-origin requests)
    const host = req && req.headers && req.headers.host;
    if (host && url.host === host) return true;
    // Allow configured hostnames from env (e.g., spaces.example.com)
    const allowed = process.env.SPACES_ALLOWED_ORIGINS;
    if (allowed && allowed.split(',').some(h => url.hostname === h.trim())) return true;
    // Otherwise reject. Previously desktop mode returned true for ANY origin,
    // which (with the desktop-local magic token) allowed a malicious web page
    // to open a WebSocket and spawn a shell on the user's machine — drive-by
    // cross-site WebSocket hijacking (review H4). No mode blanket-allows now.
    return false;
  } catch {
    return false;
  }
}

// ─── Live collab toggle handler ─────────────────────────
function handleCollabToggle(paneId, session) {
  try {
    const terminalCollab = require('../src/lib/terminal/collaboration');
    const config = terminalCollab.getCollabConfig(paneId, session.username);

    if (config) {
      // Enabling collaboration
      session.isCollaborating = true;
      session.workspaceId = config.workspaceId;
      session.paneName = config.paneName;

      const env = {
        SPACES_PANE_ID: paneId,
        SPACES_WORKSPACE_ID: config.workspaceId,
        SPACES_PANE_NAME: config.paneName,
        SPACES_USERNAME: session.username,
        SPACES_API_URL: `http://localhost:${API_PORT}`,
        SPACES_COLLABORATING: '1',
      };
      terminalCollab.writeAgentConfig(session.agentType, session.cwd, env);

      // Nudge the agent so it knows collaboration is available
      if (session.pty && !session.exited) {
        const nudge = 'Workspace collaboration has been enabled. Hooks are active — you will receive messages on the next prompt. MCP tools (post_message, read_messages) require reconnecting the MCP server (use /mcp).';
        session.pty.write(nudge);
        setTimeout(() => { if (!session.exited) session.pty.write('\r'); }, 100);
      }

      console.log(`[CollabToggle] Enabled for pane ${paneId.slice(0, 8)} (workspace ${config.workspaceId.slice(0, 8)})`);
    } else {
      // Disabling collaboration
      teams.terminal.removeAgentConfig(session.agentType, session.cwd);
      session.isCollaborating = false;
      session.workspaceId = null;

      console.log(`[CollabToggle] Disabled for pane ${paneId.slice(0, 8)}`);
    }

    // Confirm to browser
    if (session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify({ type: 'collab-updated', isCollaborating: !!config }));
    }
  } catch (e) {
    console.error(`[CollabToggle] Error for pane ${paneId.slice(0, 8)}:`, e.message);
  }
}

// ─── Shared connection handler ──────────────────────────
/**
 * Shows a runtime pane in the browser: its current screen, then its output
 * as it comes, with keys and resizes going back to the same PTY. Speaks the
 * browser's own message format, so the page cannot tell it from a pane it
 * spawned. Takes no controller slot: the terminal client and the browser
 * type into one pane side by side, as two browser tabs always could.
 */
function attachRuntimePane(ws, paneId, screen, cols, rows) {
  const runtime = getRuntime();
  const send = (msg) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); };
  console.log(`[WS] Attach runtime pane=${paneId.slice(0, 8)}`);
  const fits = (c, r) => Number.isInteger(c) && Number.isInteger(r) && c > 0 && r > 0;
  if (fits(cols, rows)) runtime.resizePane(paneId, cols, rows);
  send({ type: 'data', data: screen.replayAnsi() });
  const unsubscribe = runtime.subscribePaneData(
    paneId,
    (chunk) => send({ type: 'data', data: chunk }),
    (exitCode) => { send({ type: 'exit', exitCode }); ws.close(); },
  );
  send({ type: 'ready', paneId, reattached: true });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { runtime.writePane(paneId, raw.toString()); return; }
    if (msg.type === 'data' && typeof msg.data === 'string') runtime.writePane(paneId, msg.data);
    else if (msg.type === 'resize' && fits(msg.cols, msg.rows)) runtime.resizePane(paneId, msg.cols, msg.rows);
  });
  ws.on('close', unsubscribe);
  ws.on('error', (err) => console.log(`[WS] Error pane=${paneId.slice(0, 8)} err=${err.message}`));
}

function handleConnection(wss, ws, req) {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const url = new URL(req.url || '/', 'http://localhost');
  const paneId = url.searchParams.get('paneId') || require('crypto').randomUUID();
  const cwd = url.searchParams.get('cwd') || process.env.HOME || process.env.USERPROFILE || 'C:\\';
  const agentType = url.searchParams.get('agentType') || 'shell';
  const rawAgentSession = url.searchParams.get('agentSession') || '';
  const agentSession = (rawAgentSession === 'new' || SESSION_ID_RE.test(rawAgentSession)) ? rawAgentSession : '';
  const rawCustomCommand = url.searchParams.get('customCommand') || '';
  // Sanitize via allowlist. Any character outside [A-Za-z0-9 . _ - /] is rejected.
  // Earlier blocklist (/[;&|`$(){}]/) missed newlines, redirects (<,>), and
  // backslashes — a payload like "legit\nmalicious" would inject a second command
  // when the PTY wrote it with a trailing \r.
  const customCommand = /^[A-Za-z0-9._\-/ ]+$/.test(rawCustomCommand) ? rawCustomCommand : '';
  const cols = parseInt(url.searchParams.get('cols') || '120', 10);
  const rows = parseInt(url.searchParams.get('rows') || '30', 10);

  // Authenticate: try session cookie first (self-contained auth), then terminal token + SSO header
  let username = null;
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['spaces-session'];
  const sessionPayload = sessionToken ? verifySessionToken(sessionToken) : null;

  console.log(`[Auth] pane=${paneId.slice(0, 8)} cookie=${sessionToken ? 'present' : 'MISSING'} sessionValid=${!!sessionPayload} terminalToken=${url.searchParams.get('terminalToken') ? 'present' : 'NONE'} nodeId=${url.searchParams.get('nodeId') || 'NONE'} apiKey=${url.searchParams.get('apiKey') ? 'present' : 'NONE'}`);

  if (!IS_MULTIUSER) {
    // Desktop mode: the owner's credentials or nothing. The 'desktop-local'
    // magic token this used to honour carried no proof at all, and every
    // account on the machine could send it from the loopback interface.
    if (isDesktopOwner(req)) {
      username = os.userInfo().username;
      // When running as SYSTEM, resolve to the first real user from admin DB
      if (process.platform === "win32" && username.toUpperCase() === "SYSTEM") {
        const db = getAdminDb();
        if (db) {
          try {
            const row = db.prepare("SELECT username FROM users LIMIT 1").get();
            if (row) username = row.username;
          } catch {}
        }
      }
      console.log(`[Auth] Authenticated as the desktop owner: ${username}`);
    }
  } else if (sessionPayload) {
    // Self-contained auth: session cookie is valid
    username = sessionPayload.sub;
    console.log(`[Auth] Authenticated via session cookie: ${username}`);
  } else {
    const terminalToken = url.searchParams.get('terminalToken') || '';

    // Multiuser mode: a real signed terminal token is required — the
    // previous IP-range gate (startsWith('172.')) treated all of
    // 172.0.0.0/8 as local and was an auth bypass (review C2).
    {
      // Verify terminal token — if signed by this server's secret, trust it
      const tokenUser = verifyTerminalToken(terminalToken);
      if (tokenUser) {
        // Use the user from the signed token — do NOT trust x-auth-user header
        // as it can be spoofed by clients
        username = tokenUser;
        console.log(`[Auth] Authenticated via terminal token: ${username}`);
      } else if (terminalToken) {
        console.log(`[Auth] Terminal token FAILED: invalid or expired`);
      }
    }
  }

  // Internal token in the query string (VR client), multiuser mode only:
  // desktop mode never takes a credential from a URL, where it would land in
  // logs and histories, and the loopback check below proves nothing on a
  // machine with other accounts. Constant-time compare — the previous check
  // matched any address CONTAINING '192.168.' (substring) and used a
  // non-constant-time === (review C2).
  if (!username && IS_MULTIUSER) {
    const internalToken = url.searchParams.get('internal') || '';
    const expectedToken = process.env.SPACES_INTERNAL_TOKEN || '';
    let tokenMatch = false;
    if (internalToken && expectedToken && internalToken.length === expectedToken.length) {
      try {
        tokenMatch = crypto.timingSafeEqual(Buffer.from(internalToken), Buffer.from(expectedToken));
      } catch { tokenMatch = false; }
    }
    if (tokenMatch && isLoopback(req.socket.remoteAddress || '')) {
      username = os.userInfo().username;
      console.log(`[Auth] Authenticated via internal token (VR): ${username}`);
    }
  }

  // Network API key auth (for proxied connections from remote nodes). Part of
  // the experimental multi-machine features: off unless explicitly enabled,
  // and never a way into desktop mode, where credentials never travel in a
  // URL.
  if (!username && IS_MULTIUSER && process.env.SPACES_EXPERIMENTAL === '1') {
    const apiKey = url.searchParams.get('apiKey');
    if (apiKey) {
      console.log(`[Auth] API key provided: ${apiKey.slice(0, 4)}*** (length=${apiKey.length})`);
      const keyRecord = validateNetworkApiKey(apiKey);
      if (keyRecord) {
        console.log(`[Auth] API key validated: permissions=${keyRecord.permissions}, username=${keyRecord.username}`);
        if (keyRecord.permissions === 'terminal' || keyRecord.permissions === 'admin') {
          username = keyRecord.username || os.userInfo().username;
        } else {
          console.log(`[Auth] API key rejected: permissions="${keyRecord.permissions}" not terminal/admin`);
        }
      } else {
        console.log(`[Auth] API key validation FAILED (no matching key in DB)`);
      }
    } else {
      console.log(`[Auth] No apiKey param in WebSocket URL`);
    }
  }

  if (!username) {
    console.log(`[Auth] REJECTED connection for pane ${paneId} — no auth method succeeded`);
    ws.send(JSON.stringify({ type: 'error', data: 'Authentication required' }));
    ws.close();
    return;
  }

  // Relay to a remote node: part of the experimental multi-machine features.
  const nodeId = url.searchParams.get('nodeId');
  if (nodeId && process.env.SPACES_EXPERIMENTAL !== '1') {
    ws.send(JSON.stringify({ type: 'error', data: 'Connecting machines is experimental; start Spaces with --experimental to use it.' }));
    ws.close();
    return;
  }
  if (nodeId) {
    handleProxyConnection(ws, nodeId, { paneId, cwd, agentType, agentSession, customCommand, cols, rows });
    return;
  }

  // Check for existing session to reattach
  const existing = sessions.get(paneId);
  if (existing && existing.pty && !existing.exited) {
    // SECURITY: only the original owner may reattach. Without this, any
    // authenticated user who learns a paneId could hijack another user's PTY.
    if (existing.username !== username) {
      console.log(`[WS] REJECTED reattach pane=${paneId.slice(0,8)} — owner=${existing.username} requester=${username}`);
      ws.send(JSON.stringify({ type: 'error', data: 'Pane belongs to a different user' }));
      ws.close();
      return;
    }
    console.log(`[WS] Reattach pane=${paneId.slice(0,8)} buffer=${existing.buffer.length} chunks`);
    existing.ws = ws;

    // Replay buffered output so user sees context
    for (const chunk of existing.buffer) {
      ws.send(JSON.stringify({ type: 'data', data: chunk }));
    }

    try { existing.pty.resize(cols, rows); } catch { /* ignore */ }
    try { getRuntime().getScreen(paneId)?.resize(cols, rows); } catch { /* runtime optional here */ }

    ws.send(JSON.stringify({ type: 'ready', paneId, reattached: true }));

    // Re-send detected session ID on reattach — the original WS message may
    // have been lost if the connection dropped during detection
    if (existing.detectedSessionId) {
      ws.send(JSON.stringify({
        type: 'session-detected',
        sessionId: existing.detectedSessionId,
        paneId,
      }));
    }


    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'data') {
          existing.pty.write(msg.data);
        } else if (msg.type === 'resize') {
          try { existing.pty.resize(msg.cols, msg.rows); } catch { /* ignore */ }
          try { getRuntime().getScreen(paneId)?.resize(msg.cols, msg.rows); } catch { /* runtime optional here */ }
        } else if (msg.type === 'collab-toggle') {
          handleCollabToggle(paneId, existing);
        }
      } catch {
        existing.pty.write(raw.toString());
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[WS] Close pane=${paneId.slice(0,8)} code=${code} reason=${reason || 'none'}`);
      if (existing.ws === ws) existing.ws = null;
    });

    ws.on('error', (err) => {
      console.log(`[WS] Error pane=${paneId.slice(0,8)} err=${err.message}`);
    });

    return;
  }

  // A live pane this socket did not spawn — started from the terminal
  // client, or by an agent over /proto — is attached to, never spawned
  // again: a second PTY under the same id would run a second agent in the
  // same folder. Desktop mode only; multiuser panes all come through here.
  const runtimeScreen = IS_MULTIUSER ? null : getRuntime().getScreen(paneId);
  if (runtimeScreen) {
    attachRuntimePane(ws, paneId, runtimeScreen, cols, rows);
    return;
  }

  // Create new pty session
  const isWindows = process.platform === 'win32';

  // Resolve the OS shell user for this app user
  const shellUser = lookupShellUser(username);
  const processUser = os.userInfo().username;
  let shell, args;
  // Resolved SSH key path, hoisted out of the `if (isSSH)` block below so it
  // can be handed to spawnPane() further down (spawnPane recomputes shell/args
  // itself via the same isSSH check — this block's job is the credential
  // *provisioning* side effects spawnPane deliberately doesn't do: generating
  // a per-user key, authorizing it, and erroring the client if ssh is
  // unavailable).
  let sshKeyPath = null;
  const isSSH = shellUser !== processUser;
  if (isSSH) {
    // SSH to localhost as the mapped shell user using the service key
    const sshBin = findSshBinary();
    if (!sshBin) {
      console.error(`[Spawn] SSH binary not found — cannot spawn as ${shellUser}`);
      ws.send(JSON.stringify({ type: 'error', data: 'SSH not available. Install OpenSSH to enable multi-user terminals.' }));
      ws.close();
      return;
    }
    // Per-user key (review M1) with fallback to the shared service key. The
    // per-user path also handles on-demand provisioning (generate + authorize
    // the user's own key). Only if no per-user key is available do we fall back
    // to provisioning the shared key — preserving the prior behaviour.
    const perUserKey = ensurePerUserKey(shellUser);
    const sshKey = perUserKey || SERVICE_KEY;
    sshKeyPath = sshKey;
    if (!perUserKey && process.platform !== 'win32' && fs.existsSync(SERVICE_KEY + '.pub')) {
      try {
        const pubKey = fs.readFileSync(SERVICE_KEY + '.pub', 'utf-8').trim();
        authorizeShellUser(shellUser, pubKey);
      } catch (e) {
        console.error(`[SSH] On-demand provisioning for ${shellUser} failed (non-fatal):`, e.message);
      }
    }

    shell = sshBin;
    args = [
      '-4', // Force IPv4 — localhost may resolve to ::1 which sshd can reject
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${path.join(spacesHome(), 'known_hosts')}`,
      '-i', sshKey,
      '-t',
      `${shellUser}@localhost`,
    ];
  } else if (isWindows && agentType !== 'shell') {
    // Agents like Claude Code require bash on Windows — find git-bash
    shell = findGitBash();
    args = [];
    if (!shell) {
      shell = 'cmd.exe';
    }
  } else {
    shell = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
    args = [];
  }

  // Detect bash-on-Windows so cd commands use bash syntax, not cmd.exe `cd /d`
  const isBashOnWindows = isWindows && shell && (shell.endsWith('bash.exe') || shell.endsWith('bash'));

  // Build a minimal env for the user-facing PTY — never inherit the server's
  // secrets (SPACES_SESSION_SECRET, GH_PAT, NPM_TOKEN, ANTHROPIC_API_KEY, etc).
  // Only forward identity/shell/locale/terminal basics from the server env,
  // plus the agent-bus wiring (SPACES_PANE_ID/SPACES_API_URL) and the
  // prompt-suggestion flag. Shared with pane.create via spawn-pane.js's
  // buildPaneEnv so both spawn paths treat the server's secrets identically.
  const env = buildPaneEnv({ paneId, apiPort: API_PORT });
  // Tell Claude Code where git-bash is so it doesn't fail the bash detection
  if (isWindows && shell && shell.endsWith('bash.exe') && !env.CLAUDE_CODE_GIT_BASH_PATH) {
    env.CLAUDE_CODE_GIT_BASH_PATH = shell;
  }

  // Fall back to HOME if cwd doesn't exist (e.g. remote path from another node)
  let safeCwd = cwd;
  if (!fs.existsSync(safeCwd)) {
    safeCwd = os.homedir();
    console.log(`[Spawn] cwd "${cwd}" does not exist, falling back to "${safeCwd}"`);
  }

  // Look up workspace collaboration config from the local terminal-collab module
  let isCollaborating = false;
  try {
    const terminalCollab = require('../src/lib/terminal/collaboration');
    const config = terminalCollab.getCollabConfig(paneId, username);
    if (config) {
      env.SPACES_WORKSPACE_ID = config.workspaceId;
      env.SPACES_PANE_NAME = config.paneName;
      env.SPACES_USERNAME = username;
      isCollaborating = true;
      env.SPACES_COLLABORATING = '1';
      console.log(`[Collab] Enabled for pane ${paneId.slice(0, 8)} — workspace ${config.workspaceId}, name "${config.paneName}"`);
    }
  } catch (e) {
    console.error(`[Collab] Failed to check collaboration config for pane ${paneId.slice(0, 8)}:`, e.message);
  }

  console.log(`[Spawn] user=${username} shell=${shell} args=${JSON.stringify(args)} cwd=${safeCwd} agentType=${agentType} agentSession=${agentSession || 'NONE'}`);

  // Spawn through the shared seam (also used by /proto pane.create): resolves
  // shell/args itself (SSH remoting when shellUser differs from the local OS
  // user, checked first; Windows git-bash for non-shell agents; else plain
  // shell), spawns the PTY, and registers it with the runtime-core singleton so
  // it shows up in /proto session.snapshot and pane.read/pane.input/pane.resize
  // work. Only reached on the fresh-spawn path — the reattach branch above
  // returns early and never reaches here, so an already-live paneId can't be
  // re-registered (which would otherwise leak the previous PaneScreen). Note:
  // this file's own shell/args resolution above still runs unchanged — it does
  // the SSH credential *provisioning* side effects
  // (ensurePerUserKey/authorizeShellUser) spawnPane deliberately doesn't, and
  // its outputs (isBashOnWindows, the [Spawn] log line, the pre-set
  // CLAUDE_CODE_GIT_BASH_PATH) are still used below.
  const spawned = spawnPane({
    paneId, cwd: safeCwd, agentType, cols, rows, env,
    runtime: getRuntime(),
    workspaceId: normalizeRuntimeWorkspaceId(env.SPACES_WORKSPACE_ID),
    customCommand, agentSession,
    shellUser, sshKeyPath,
  });
  if (!spawned.ok) {
    console.error(`[Spawn Error] ${spawned.error} (cwd=${safeCwd}, agentType=${agentType})`);
    ws.send(JSON.stringify({ type: 'error', data: `Failed to spawn terminal: ${spawned.error}` }));
    ws.close();
    return;
  }
  const term = spawned.term;

  const session = {
    pty: term, ws, buffer: [], exited: false, username,
    agentType,
    cwd: safeCwd,
    paneName: env.SPACES_PANE_NAME || paneId,
    lastOutputTime: Date.now(),
    lastNudgeTime: 0,
    startedAt: Date.now(),
    workspaceId: env.SPACES_WORKSPACE_ID || null,
    isCollaborating,
    detectedSessionId: null,  // Populated when Claude session is detected
  };
  sessions.set(paneId, session);
  analyticsRecordSessionStart(paneId, username, agentType);

  // ─── Inject cd for SSH sessions, then agent command ─────
  const agent = AGENTS[agentType] || AGENTS.shell;

  // SSH sessions start in the remote user's home dir — cd to target cwd first
  if (isSSH) {
    setTimeout(() => {
      if (!session.exited) {
        if (isWindows && !isBashOnWindows) {
          // Windows cmd.exe uses double quotes and /d to change drive
          const escapedCwd = safeCwd.replace(/"/g, '""');
          term.write(`cd /d "${escapedCwd}"\r`);
        } else {
          // Unix shells (including git-bash on Windows) use single quotes
          const escapedCwd = safeCwd.replace(/'/g, "'\\''");
          term.write(`cd '${escapedCwd}'\r`);
        }
      }
    }, 300);
  }

  // Write collaboration config for agent panes via the local terminal-collab module
  if (isCollaborating && agentType !== 'shell') {
    try {
      const terminalCollab = require('../src/lib/terminal/collaboration');
      terminalCollab.writeAgentConfig(agentType, safeCwd, env);
      console.log(`[Collab] Wrote agent config for pane ${paneId.slice(0, 8)} (${agentType}) in ${safeCwd}`);
    } catch (e) {
      console.error(`[Collab] Failed to write agent config for pane ${paneId.slice(0, 8)}:`, e.message);
    }
  }

  if (agentType !== 'shell') {
    const command = agentType === 'custom' ? customCommand : agent.command;

    if (command) {
      const delay = isSSH ? 800 : 300;

      if (agentSession && agentSession !== 'new' && agent.resumeFlag) {
        // Resume an existing session
        if (agentType === 'claude' || agentType === 'pi') {
          let sessionCwd = null;
          let sessionExists = false;

          if (agentType === 'claude') {
            // Claude needs to be run from the correct project CWD
            sessionCwd = findSessionCwd(agentSession, username);

            // Verify the session actually exists on disk before attempting resume.
            // If the .jsonl file is gone (cleanup, etc.), fall back to `--continue`
            // which resumes the most recent conversation in this project — much
            // better than starting completely fresh.
            sessionExists = sessionCwd !== null || findSessionFile(agentSession, username);
          } else if (agentType === 'pi') {
            sessionExists = findPiSessionFile(agentSession, username, safeCwd);
          }

          if (!sessionExists) {
            console.log(`[Resume] Session ${agentSession.slice(0, 8)} not found on disk for pane ${paneId.slice(0, 8)} — falling back to --continue`);
            // Don't clear the session ID yet — let session detection update it
            // once Claude actually starts a conversation.
            setTimeout(() => {
              if (!session.exited) {
                term.write(`${command} --continue\r`);
              }
            }, delay);
          } else {
            setTimeout(() => {
              if (session.exited) return;
              if (sessionCwd && sessionCwd !== safeCwd) {
                // Use bash-compatible cd on Windows when shell is git-bash
                const cdCmd = (isWindows && !isBashOnWindows) ? `cd /d "${sessionCwd}"` : `cd "${sessionCwd}"`;
                term.write(cdCmd + '\r');
                setTimeout(() => {
                  if (!session.exited) {
                    term.write(`${command} ${agent.resumeFlag} ${agentSession}\r`);
                  }
                }, 300);
              } else {
                term.write(`${command} ${agent.resumeFlag} ${agentSession}\r`);
              }
            }, delay);
          }
        } else {
          // Generic resume: works for both subcommand (codex resume <id>) and flag (gemini --resume <id>)
          // 'bare' resumeStyle means the flag takes no argument (e.g. pi --continue)
          setTimeout(() => {
            if (!session.exited) {
              if (agent.resumeStyle === 'bare') {
                term.write(`${command} ${agent.resumeFlag}\r`);
              } else {
                // spawned.launchCommand === `${command} ${agent.resumeFlag} ${agentSession}`
                // here — buildLaunchCommand's resumable branch, since this
                // else-branch is only reached when agentSession/resumeFlag
                // both hold (same condition buildLaunchCommand checks).
                term.write(`${spawned.launchCommand}\r`);
              }
            }
          }, delay);
        }
      } else {
        // Start new session. spawned.launchCommand === `command` here —
        // buildLaunchCommand's non-resumable branch returns agent.command
        // (or customCommand), exactly what `command` above computed inline.
        setTimeout(() => {
          if (!session.exited) {
            term.write(`${spawned.launchCommand}\r`);
          }
        }, delay);
      }
    }
  }

  // pty -> ws (and buffer). Runtime forwarding (getRuntime().feed) is already
  // wired by spawnPane's own term.onData subscriber above — node-pty supports
  // multiple onData subscribers, so this one only needs its own concern:
  // client replay buffer + WebSocket send.
  term.onData((data) => {
    session.lastOutputTime = Date.now();
    session.buffer.push(data);
    if (session.buffer.length > MAX_BUFFER_LINES) {
      session.buffer.shift();
    }

    if (session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify({ type: 'data', data }));
    }
  });

  // Runtime exit forwarding (getRuntime().paneExit) is already wired by
  // spawnPane's own term.onExit subscriber above; this one only needs its own
  // concern: exit frame + 120s session cleanup.
  term.onExit(({ exitCode }) => {
    session.exited = true;
    analyticsRecordSessionEnd(paneId);
    // Clean up hook state file
    try {
      const hookStateFile = path.join(spacesHome(), 'hook-state', `${paneId}.json`);
      if (fs.existsSync(hookStateFile)) fs.unlinkSync(hookStateFile);
    } catch { /* ignore */ }
    if (session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify({ type: 'exit', exitCode }));
    }
    setTimeout(() => {
      if (sessions.get(paneId) === session) {
        sessions.delete(paneId);
      }
    }, 120000);
  });

  // ws -> pty
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'data') {
        term.write(msg.data);
      } else if (msg.type === 'resize') {
        try { term.resize(msg.cols, msg.rows); } catch { /* ignore */ }
        try { getRuntime().getScreen(paneId)?.resize(msg.cols, msg.rows); } catch { /* runtime optional here */ }
      } else if (msg.type === 'collab-toggle') {
        handleCollabToggle(paneId, session);
      }
    } catch {
      term.write(raw.toString());
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Close pane=${paneId.slice(0,8)} code=${code} reason=${reason || 'none'}`);
    if (session.ws === ws) session.ws = null;
  });

  ws.on('error', (err) => {
    console.log(`[WS] Error pane=${paneId.slice(0,8)} err=${err.message}`);
  });

  ws.send(JSON.stringify({ type: 'ready', paneId }));

  // Confirm actual collaboration state so browser syncs with backend
  ws.send(JSON.stringify({ type: 'collab-updated', isCollaborating }));

  // ─── Session ID detection ────────────────────────────────
  if (agentType === 'claude') {
    detectNewClaudeSession(paneId, cwd, ws, session, username);
    // Also start continuous tracking — detects when the user switches sessions
    // inside Claude via /resume, /new, etc. (the one-shot detector above only
    // catches the initial session creation).
    trackActiveClaudeSession(paneId, cwd, session, username);
  } else if (agentType === 'codex' && (!agentSession || agentSession === 'new')) {
    detectNewCodexSession(paneId, cwd, ws, session, username);
  } else if (agentType === 'gemini') {
    detectNewGeminiSession(paneId, cwd, ws, session, username);
  } else if (agentType === 'forge') {
    detectNewForgeSession(paneId, cwd, ws, session, username);
  } else if (agentType === 'pi') {
    detectNewPiSession(paneId, cwd, ws, session, username);
  }
}

// ─── Claude-specific helpers ──────────────────────────────

function getUserHome(username) {
  const shellUser = lookupShellUser(username);
  if (shellUser === os.userInfo().username) return os.homedir();
  if (process.platform === 'win32') {
    // On Windows, user profiles live under the Users directory
    const usersDir = path.dirname(os.homedir());
    const userHome = path.join(usersDir, shellUser);
    if (fs.existsSync(userHome)) return userHome;
    return os.homedir();
  }
  return `/home/${shellUser}`;
}

const UUID_JSONL_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

/**
 * Convert a CWD path to the project directory key used by Claude Code.
 * Claude encodes paths by replacing colons, slashes, backslashes, and spaces with dashes.
 * e.g. "C:\projects\my-app" → "C--projects-my-app"
 * e.g. "/home/user/projects"      → "-home-user-projects"
 */
function cwdToProjectKey(cwd) {
  return cwd.replace(/[:\\/\s]/g, '-').replace(/-$/, '');
}

/**
 * Check if a Claude session's .jsonl file exists on disk (without parsing CWD).
 * Used to verify a session is resumable before attempting `claude --resume`.
 */
function findSessionFile(sessionId, username) {
  const claudeProjectsDir = path.join(getUserHome(username), '.claude', 'projects');
  try {
    if (!fs.existsSync(claudeProjectsDir)) return false;
    const fileName = `${sessionId}.jsonl`;
    for (const projDir of fs.readdirSync(claudeProjectsDir, { withFileTypes: true })) {
      if (!projDir.isDirectory()) continue;
      if (fs.existsSync(path.join(claudeProjectsDir, projDir.name, fileName))) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function findPiSessionFile(sessionId, username, cwd) {
  const homeDir = getUserHome(username);
  const globalSessionsDir = path.join(homeDir, '.pi', 'agent', 'sessions');
  const projectSessionsDir = path.join(cwd, '.pi', 'sessions');

  for (const dir of [globalSessionsDir, projectSessionsDir]) {
    try {
      if (fs.existsSync(dir)) {
        for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
          if (sub.isDirectory()) {
            for (const file of fs.readdirSync(path.join(dir, sub.name))) {
              if (file.endsWith('.jsonl') && file.includes(sessionId)) return true;
            }
          } else if (sub.isFile() && sub.name.endsWith('.jsonl') && sub.name.includes(sessionId)) {
            return true;
          }
        }
      }
    } catch { /* ignore */ }
  }
  return false;
}

function findSessionCwd(sessionId, username) {
  const claudeProjectsDir = path.join(getUserHome(username), '.claude', 'projects');
  try {
    if (!fs.existsSync(claudeProjectsDir)) return null;
    const fileName = `${sessionId}.jsonl`;

    for (const projDir of fs.readdirSync(claudeProjectsDir, { withFileTypes: true })) {
      if (!projDir.isDirectory()) continue;
      const filePath = path.join(claudeProjectsDir, projDir.name, fileName);
      if (fs.existsSync(filePath)) {
        // Try to find cwd in the jsonl first few lines
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);

        const chunk = buf.toString('utf-8', 0, bytesRead);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.cwd) {
              console.log(`[Session CWD] ${sessionId.slice(0, 8)}: ${entry.cwd}`);
              return entry.cwd;
            }
          } catch { /* skip */ }
        }

        // Fallback: derive CWD from the project directory name.
        // NOTE: this is inherently ambiguous — hyphens in directory names
        // (e.g. "my-app") are indistinguishable from path separators
        // in the encoded form. Only use this if the .jsonl had no cwd field.
        let derivedPath;
        const winDriveMatch = projDir.name.match(/^([A-Za-z])--(.*)/);
        if (winDriveMatch) {
          // Windows: "C--projects-my-app" → try "C:\projects\my-app" etc.
          // We can't perfectly reverse the encoding due to hyphen ambiguity,
          // but the drive letter prefix (X--) is unambiguous.
          derivedPath = winDriveMatch[1] + ':\\' + winDriveMatch[2].replace(/-/g, '\\');
        } else {
          // Unix: "-home-user-projects" → "/home/user/projects"
          derivedPath = '/' + projDir.name.replace(/^-/, '').replace(/-/g, '/');
        }
        if (derivedPath && fs.existsSync(derivedPath)) {
          console.log(`[Session CWD] ${sessionId.slice(0, 8)}: ${derivedPath} (derived from dir name)`);
          return derivedPath;
        }
      }
    }
  } catch (err) {
    console.error(`[Session CWD] Error looking up ${sessionId}:`, err.message);
  }
  return null;
}

/**
 * Persist a detected session ID directly to the SQLite database.
 * Previously this went through the Next.js HTTP API, but that was fragile
 * (308 redirects from trailingSlash, auth issues, timing).  Direct DB write
 * is immediate and reliable — SQLite WAL mode handles concurrent access.
 */
function persistSessionToDb(paneId, sessionId) {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(spacesHome(), 'spaces.db');
    if (!fs.existsSync(dbPath)) {
      console.error(`[Session Persist] DB not found: ${dbPath}`);
      return;
    }
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    const result = db.prepare('UPDATE panes SET claude_session_id = ? WHERE id = ?').run(sessionId, paneId);
    db.close();
    if (result.changes > 0) {
      console.log(`[Session Persist] Saved session ${sessionId.slice(0, 8)} for pane ${paneId.slice(0, 8)}`);
    } else {
      console.error(`[Session Persist] Pane ${paneId.slice(0, 8)} not found in DB`);
    }
  } catch (err) {
    console.error(`[Session Persist] DB write failed for pane ${paneId.slice(0, 8)}: ${err.message}`);
  }
  try { getRuntime().state.setSessionRef(paneId, { id: sessionId, transcriptPath: null }); } catch { /* runtime optional here */ }
}

/**
 * Continuously track which Claude session is active by watching which .jsonl
 * file in the project directory was most recently modified.  This catches
 * session changes the user makes *inside* Claude (/resume, /new, etc.)
 * that the one-shot detectNewClaudeSession poller can't see.
 *
 * Runs every 30s for the lifetime of the PTY.
 */
function trackActiveClaudeSession(paneId, cwd, session, username) {
  const claudeProjectsDir = path.join(getUserHome(username), '.claude', 'projects');
  const expectedProjectKey = cwdToProjectKey(cwd);
  const expectedProjPath = path.join(claudeProjectsDir, expectedProjectKey);

  // Wait 60s before starting — give detectNewClaudeSession time to do its thing first
  const startDelay = 60000;
  const pollInterval = 30000;

  setTimeout(() => {
    if (session.exited) return;

    const interval = setInterval(() => {
      if (session.exited) {
        clearInterval(interval);
        return;
      }

      try {
        if (!fs.existsSync(expectedProjPath)) return;

        // Find the most recently modified .jsonl file in the project directory
        let newest = null;
        let newestMtime = 0;

        for (const item of fs.readdirSync(expectedProjPath)) {
          const m = item.match(UUID_JSONL_RE);
          if (!m) continue;
          const fullPath = path.join(expectedProjPath, item);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.mtimeMs > newestMtime) {
              newestMtime = stat.mtimeMs;
              newest = m[1]; // UUID from filename
            }
          } catch { /* ignore */ }
        }

        if (!newest) return;

        // Only update if the active session actually changed AND the file was
        // touched recently (within the last 5 minutes — not stale)
        const isRecent = (Date.now() - newestMtime) < 5 * 60 * 1000;
        if (newest !== session.detectedSessionId && isRecent) {
          console.log(`[Session Track] Pane ${paneId.slice(0, 8)}: active session changed ${(session.detectedSessionId || 'none').slice(0, 8)} → ${newest.slice(0, 8)}`);
          session.detectedSessionId = newest;
          persistSessionToDb(paneId, newest);
          if (session.ws && session.ws.readyState === 1) {
            session.ws.send(JSON.stringify({ type: 'session-detected', sessionId: newest, paneId }));
          }
        }
      } catch { /* ignore */ }
    }, pollInterval);
  }, startDelay);
}

function detectNewClaudeSession(paneId, cwd, ws, session, username) {
  const claudeProjectsDir = path.join(getUserHome(username), '.claude', 'projects');

  // CRITICAL FIX: scope detection to the project directory matching this pane's CWD.
  const expectedProjectKey = cwdToProjectKey(cwd);
  const expectedProjPath = path.join(claudeProjectsDir, expectedProjectKey);

  const knownSessionIds = new Set();
  const startedAt = session.startedAt || Date.now();
  const SLACK_MS = 10000; // Claude can be slow to start writing

  try {
    if (fs.existsSync(expectedProjPath)) {
      for (const item of fs.readdirSync(expectedProjPath)) {
        const m = item.match(UUID_JSONL_RE);
        if (m) knownSessionIds.add(m[1]);
      }
    }
  } catch { /* ignore */ }

  console.log(`[Session Detect] Pane ${paneId.slice(0, 8)} (${username}): scanning ${expectedProjectKey} — snapshot ${knownSessionIds.size} existing sessions`);

  let attempts = 0;
  const maxAttempts = 45;
  const interval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts || session.exited) {
      clearInterval(interval);
      if (attempts > maxAttempts) {
        console.log(`[Session Detect] Pane ${paneId.slice(0, 8)}: timed out after ${maxAttempts * 2}s waiting for session in ${expectedProjectKey}`);
      }
      return;
    }

    try {
      if (!fs.existsSync(expectedProjPath)) return;

      for (const item of fs.readdirSync(expectedProjPath)) {
        const m = item.match(UUID_JSONL_RE);
        if (m && !knownSessionIds.has(m[1])) {
          const newSessionId = m[1];
          const fullPath = path.join(expectedProjPath, item);
          
          // Verify that this session actually belongs to this PTY by checking its start time.
          // Claude's .jsonl files have a 'created' or first message timestamp.
          const head = readFileHead(fullPath, 4096);
          const firstLine = head.split('\n').find(l => l.trim().length > 0);
          if (firstLine) {
            try {
              const entry = JSON.parse(firstLine);
              const timestamp = entry.timestamp || entry.created;
              if (timestamp) {
                const sessionStart = new Date(timestamp).getTime();
                if (Math.abs(sessionStart - startedAt) > SLACK_MS) {
                  knownSessionIds.add(newSessionId); // Not ours
                  continue;
                }
              }
            } catch { /* ignore parse error, try again next interval */ continue; }
          } else {
            // File might be empty still, wait for next interval
            continue;
          }

          clearInterval(interval);
          console.log(`[Session Detect] Pane ${paneId.slice(0, 8)} (${username}): detected session ${newSessionId} for project ${expectedProjectKey}`);

          // Cache in memory so reattaching WebSocket gets the session ID
          session.detectedSessionId = newSessionId;

          // Persist to DB server-side — this is the reliability backstop.
          persistSessionToDb(paneId, newSessionId);

          // Also notify the frontend via WebSocket
          if (session.ws && session.ws.readyState === 1) {
            session.ws.send(JSON.stringify({
              type: 'session-detected',
              sessionId: newSessionId,
              paneId,
            }));
          }
          return;
        }
      }
    } catch { /* ignore */ }
  }, 2000);
}

// ─── Proxy: forward connection to remote node ──────────

async function handleProxyConnection(clientWs, nodeId, opts) {
  const { paneId, cwd, agentType, agentSession, customCommand, cols, rows } = opts;

  const node = getNodeInfo(nodeId);
  if (!node) {
    clientWs.send(JSON.stringify({ type: 'error', data: `Node ${nodeId} not found` }));
    clientWs.close();
    return;
  }

  const apiKey = decryptNodeApiKey(node.api_key_encrypted);
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', data: 'Cannot decrypt API key for remote node' }));
    clientWs.close();
    return;
  }

  // Get the remote WebSocket URL via the terminal token endpoint.
  // If the user opted into skipping TLS verification (for self-signed federation
  // certs), scope it to JUST this request via an undici Agent rather than the
  // process-global NODE_TLS_REJECT_UNAUTHORIZED env var, which would disable
  // cert verification for every outbound TLS connection in the process and
  // race with concurrent requests.
  const skipTls = process.env.SPACES_SKIP_TLS_VERIFY === '1';
  let fetchOptions = {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  };
  if (skipTls) {
    try {
      const { Agent } = require('undici');
      fetchOptions.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } catch (e) {
      console.warn('[Proxy] undici unavailable for per-request TLS opt-out; refusing to fall back to global flag');
    }
  }
  let remoteWsUrl;
  try {
    const tokenUrl = `${node.url}/api/network/terminal/token/`;
    const res = await fetch(tokenUrl, fetchOptions);

    if (!res.ok) {
      let detail = '';
      try { const body = await res.json(); detail = body.error || JSON.stringify(body); } catch { detail = await res.text().catch(() => `HTTP ${res.status}`); }
      clientWs.send(JSON.stringify({ type: 'error', data: `Remote terminal auth failed: ${detail}` }));
      clientWs.close();
      return;
    }

    const data = await res.json();
    remoteWsUrl = data.wsUrl;
  } catch (err) {
    clientWs.send(JSON.stringify({ type: 'error', data: `Cannot reach remote node: ${err.message}` }));
    clientWs.close();
    return;
  }

  // Connect to remote terminal server using the API key directly.
  // The terminal token approach fails because the proxied WebSocket has no
  // x-auth-user header, so the remote server can't match the token's username
  // to the request. API key auth on the WebSocket is the reliable path.
  const WebSocket = require('ws');
  const remoteParams = new URLSearchParams({
    paneId,
    cwd,
    agentType,
    cols: String(cols),
    rows: String(rows),
    apiKey: apiKey,
  });
  if (agentSession) remoteParams.set('agentSession', agentSession);
  // Never forward customCommand to remote nodes — too dangerous

  // Upgrade ws:// to wss:// if the node uses https
  let wsUrl = remoteWsUrl;
  if (node.url.startsWith('https://') && wsUrl.startsWith('ws://')) {
    wsUrl = 'wss://' + wsUrl.slice(5);
  }
  const remoteUrl = `${wsUrl}?${remoteParams}`;
  console.log(`[Proxy] Connecting to remote node ${nodeId.slice(0, 8)}`);

  const remoteWs = new WebSocket(remoteUrl, { rejectUnauthorized: !skipTls ? undefined : false });

  remoteWs.on('open', () => {
    console.log(`[Proxy] Connected to remote node ${nodeId.slice(0, 8)} for pane ${paneId.slice(0, 8)}`);
  });

  // Pipe data bidirectionally
  let firstMsg = true;
  remoteWs.on('message', (data) => {
    const str = data.toString();
    if (firstMsg) {
      console.log(`[Proxy] First message from remote for pane ${paneId.slice(0, 8)}: ${str.slice(0, 200)}`);
      firstMsg = false;
    }
    if (clientWs.readyState === 1) {
      clientWs.send(str);
    }
  });

  clientWs.on('message', (data) => {
    if (remoteWs.readyState === 1) {
      remoteWs.send(data.toString());
    }
  });

  // Handle closes
  remoteWs.on('close', () => {
    console.log(`[Proxy] Remote connection closed for pane ${paneId.slice(0, 8)}`);
    if (clientWs.readyState === 1) {
      clientWs.send(JSON.stringify({ type: 'exit', exitCode: -1, reason: 'Remote connection closed' }));
    }
  });

  remoteWs.on('error', (err) => {
    console.error(`[Proxy] Remote error for pane ${paneId.slice(0, 8)}:`, err.message);
    if (clientWs.readyState === 1) {
      clientWs.send(JSON.stringify({ type: 'error', data: `Remote error: ${err.message}` }));
    }
  });

  clientWs.on('close', () => {
    console.log(`[Proxy] Client disconnected for pane ${paneId.slice(0, 8)}`);
    if (remoteWs.readyState === 1) {
      remoteWs.close();
    }
  });
}

// ─── Shared WSS setup (attach handlers to any WebSocketServer) ──

function setupWss(wss) {
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('connection', (ws, req) => handleConnection(wss, ws, req));

  wss.on('error', (err) => {
    console.error('[Terminal Server] Error:', err.message);
  });

  // Initialize analytics DB
  getAdminDbRW();

  return pingInterval;
}

// ─── /proto liveness + error handling ────────────────────────
// setupWss() is not reusable as-is for protoWss: its 'connection' handler
// is hardwired to handleConnection (the legacy /ws PTY-spawning flow), which
// would be wrong for control-channel sockets — attachControlChannel already
// owns each /proto socket via the handleUpgrade callback in the upgrade
// handler below, not a 'connection' listener. This replicates just the
// dead-peer ping/pong sweep and server-level error handler setupWss gives
// the legacy wss, so /proto gets the same heartbeat and crash protection.
function setupProtoWss(protoWss) {
  const pingInterval = setInterval(() => {
    protoWss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  protoWss.on('error', (err) => {
    console.error('[Terminal Server] /proto error:', err.message);
  });

  return pingInterval;
}

function startMdnsIfNeeded(httpPort) {
  // mDNS broadcasts this node on the LAN. Gate on multiuser mode so solo
  // desktop users don't silently advertise themselves.
  if (!IS_MULTIUSER) {
    console.log('[mDNS] Skipped (desktop mode; set SPACES_MULTIUSER=1 to advertise)');
    return;
  }
  try {
    const { startMdns } = require('./mdns-service');
    startMdns(httpPort || PORT);
  } catch (err) {
    console.log('[mDNS] Discovery not available:', err.message);
  }
}

// ─── Poll-based idle nudge for agent collaboration ───────

function startMessageWatcher(apiPort) {
  try {
    const terminalCollab = require('../src/lib/terminal/collaboration');
    terminalCollab.startMessageWatcher(apiPort, sessions);
  } catch (e) { console.log('[collab] Message watcher not started:', e.message); }
}

// ─── Attached mode: mount on an existing HTTP server ─────

function createTerminalServer(httpServer) {
  // In attached mode, the API is served by the parent HTTP server, not on PORT (3458).
  if (httpServer.listening) {
    API_PORT = httpServer.address().port;
    waitForApi();
  } else {
    httpServer.on('listening', () => { API_PORT = httpServer.address().port; waitForApi(); });
  }

  const wss = new WebSocketServer({ noServer: true });
  setupWss(wss);

  const protoWss = new WebSocketServer({ noServer: true });
  setupProtoWss(protoWss);

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');

    // Desktop mode: a hostname other than this machine's loopback is a page
    // somewhere else that rebound its name to 127.0.0.1. Its Origin agrees
    // with its Host, so the origin checks below cannot tell; this can.
    if (!IS_MULTIUSER && !desktopAuth.isLocalHost(req.headers.host, allowedHosts())) {
      socket.destroy();
      return;
    }
    // Desktop mode: a browser socket must come from Spaces' own page. Any
    // localhost origin used to pass, and every port on localhost is the same
    // site, so a page served from another local port could open a terminal
    // with the owner's cookie. Non-browser clients send no Origin and must
    // present a bearer token instead.
    if (!IS_MULTIUSER && req.headers.origin
      && !desktopAuth.originIsSelf(req.headers.origin, req.headers.host)) {
      socket.destroy();
      return;
    }

    // Pane-data-socket route (/proto/pane/<id>) — matched here, before the
    // exact-/proto branch below, since it shares the /proto prefix. Same
    // Origin check + auth gate as the control channel below.
    const paneMatch = url.pathname.match(/\/proto\/pane\/([^/]+)$/);
    if (paneMatch) {
      // SECURITY (Phase-1 restriction): /proto has no per-pane ownership
      // check — checkProtoAuth() only proves the caller holds *some* valid
      // session/terminal token, and the runtime never records which user
      // opened a pane. Under multiuser mode that would let any authenticated
      // user snapshot/read/input, or fully take over (?takeover=1), ANY
      // other user's pane. The legacy /ws path guards exactly this case (see
      // the SECURITY comment at the reattach-ownership check above, around
      // handleConnection's `existing.username !== username` branch). Until
      // pane ownership (username) is threaded through registerPane and
      // enforced in dispatch/pane-socket filters, refuse both proto routes
      // entirely in multiuser mode rather than exposing them.
      if (IS_MULTIUSER) {
        socket.destroy();
        return;
      }

      const origin = req.headers.origin;
      if (origin && !isAllowedOrigin(origin, req)) {
        socket.destroy();
        return;
      }

      // decodeURIComponent throws URIError on malformed percent-encoding
      // (e.g. `%zz`). ws.handleUpgrade invokes its callback synchronously,
      // so an uncaught throw here would escape this 'upgrade' handler —
      // and with no process-level uncaughtException handler anywhere in the
      // repo, that takes down the whole process (terminal server + Next.js
      // share it). Decode before handing off to handleUpgrade so a bad pane
      // id just drops this one connection.
      let paneId;
      try {
        paneId = decodeURIComponent(paneMatch[1]);
      } catch {
        socket.destroy();
        return;
      }

      const mode = url.searchParams.get('mode') === 'control' ? 'control' : 'observe';
      const takeover = url.searchParams.get('takeover') === '1';
      // A pane on another machine. The client asks for it exactly as it asks
      // for a local one and adds the machine it belongs to; everything past
      // this point is a byte pipe, so the client never learns the difference.
      const remoteNodeId = url.searchParams.get('nodeId');

      protoWss.handleUpgrade(req, socket, head, (ws) => {
        const authenticated = checkProtoAuth(req);
        if (remoteNodeId && authenticated) {
          const federation = getFederationContext();
          if (!federation) {
            ws.send(JSON.stringify({
              type: 'error',
              code: 'not_found',
              message: 'federation is not enabled on this machine',
            }));
            ws.close();
            return;
          }
          require('./lib/network/pane-relay')
            .relayPane({
              clientWs: ws,
              nodeId: remoteNodeId,
              paneId,
              identity: federation.identity,
              db: federation.db,
              mode,
              takeover,
            })
            .catch((e) => {
              console.error(`[Proto] Pane relay failed: ${e.message}`);
              try { ws.close(); } catch { /* already gone */ }
            });
          return;
        }
        attachPaneSocket(ws, getRuntime(), { paneId, mode, takeover, authenticated });
      });
      return;
    }

    if (url.pathname === '/proto' || url.pathname.endsWith('/proto')) {
      // SECURITY (Phase-1 restriction): see the comment above the
      // /proto/pane/<id> branch — same per-pane-ownership gap applies to the
      // control channel's session.snapshot/pane.* dispatch.
      if (IS_MULTIUSER) {
        socket.destroy();
        return;
      }

      // Verify origin for browser clients, same as /ws below.
      const origin = req.headers.origin;
      if (origin && !isAllowedOrigin(origin, req)) {
        socket.destroy();
        return;
      }
      protoWss.handleUpgrade(req, socket, head, (ws) => {
        const authenticated = checkProtoAuth(req);
        attachControlChannel(ws, getRuntime(), { authenticated });
      });
      return;
    }

    if (url.pathname === '/ws' || url.pathname.endsWith('/ws')) {
      // Verify origin for browser clients
      const origin = req.headers.origin;
      if (origin && !isAllowedOrigin(origin, req)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
    // Non-/ws, non-/proto upgrades are left for other listeners (e.g. HMR proxy)
  });

  // Start mDNS and message watcher once we know the HTTP port
  if (httpServer.listening) {
    startMdnsIfNeeded(httpServer.address().port);
    startMessageWatcher(httpServer.address().port);
  } else {
    httpServer.on('listening', () => {
      startMdnsIfNeeded(httpServer.address().port);
      startMessageWatcher(httpServer.address().port);
    });
  }
  return wss;
}

// ─── Standalone mode (run directly) ──────────────────────

if (require.main === module) {
  const wss = new WebSocketServer({
    port: PORT,
    verifyClient: ({ req }) => {
      const origin = req.headers.origin;
      if (!origin) return true;
      return isAllowedOrigin(origin, req);
    },
  });
  setupWss(wss);
  startMdnsIfNeeded();
  startMessageWatcher(PORT);
  console.log(`Terminal WebSocket server running on ws://localhost:${PORT}`);
}

function detectNewGeminiSession(paneId, cwd, ws, session, username) {
  const homeDir = getUserHome(username);
  const geminiDir = path.join(homeDir, '.gemini');
  const registryPath = path.join(geminiDir, 'projects.json');
  const tmpDir = path.join(geminiDir, 'tmp');

  // Find project slug from CWD
  let slug = null;
  try {
    if (fs.existsSync(registryPath)) {
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      const isWin = process.platform === 'win32';
      const resolvedCwd = path.resolve(cwd);
      
      for (const [p, entry] of Object.entries(registry)) {
        const resolvedP = path.resolve(p);
        if (isWin) {
          if (resolvedP.toLowerCase() === resolvedCwd.toLowerCase()) {
            slug = entry.id || entry;
            break;
          }
        } else {
          if (resolvedP === resolvedCwd) {
            slug = entry.id || entry;
            break;
          }
        }
      }
    }
  } catch { /* ignore */ }

  if (!slug) {
    console.log(`[Session Detect] Gemini: No project slug found for ${cwd}`);
    return;
  }

  const chatsDir = path.join(tmpDir, slug, 'chats');
  const knownIds = new Set();
  const startedAt = session.startedAt || Date.now();
  const SLACK_MS = 8000; // Allow 8s difference between PTY start and session file creation

  try {
    if (fs.existsSync(chatsDir)) {
      for (const file of fs.readdirSync(chatsDir)) {
        if (file.startsWith('session-') && file.endsWith('.json')) {
          knownIds.add(path.basename(file, '.json'));
        }
      }
    }
  } catch { /* ignore */ }

  console.log(`[Session Detect] Gemini: scanning ${slug} — snapshot ${knownIds.size} existing sessions`);

  let attempts = 0;
  const maxAttempts = 45;
  const interval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts || session.exited) {
      clearInterval(interval);
      return;
    }

    try {
      if (!fs.existsSync(chatsDir)) return;
      const files = fs.readdirSync(chatsDir);
      
      for (const file of files) {
        if (!file.startsWith('session-') || !file.endsWith('.json')) continue;
        const id = path.basename(file, '.json');
        
        // If it's a new file, or an existing file that was just updated/re-created
        if (!knownIds.has(id)) {
          try {
            const fullPath = path.join(chatsDir, file);
            const sessionData = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
            
            // Validate that this session started roughly when our PTY started.
            // This prevents Pane A from stealing Pane B's session if they start together.
            const sessionStart = new Date(sessionData.startTime).getTime();
            if (Math.abs(sessionStart - startedAt) > SLACK_MS) {
              // Not our session (too old or too new relative to this pane)
              knownIds.add(id); // Don't check this file again
              continue;
            }

            const realId = sessionData.sessionId;
            if (realId) {
              clearInterval(interval);
              
              // CRITICAL: Gemini CLI uses the "short ID" (first 8 chars of UUID) for resumes.
              // Storing the full UUID in the DB causes "Invalid session identifier" errors.
              const harnessId = realId.split('-')[0];
              
              console.log(`[Session Detect] Gemini: detected session ${harnessId} (UUID ${realId}) for pane ${paneId.slice(0, 8)}`);
              session.detectedSessionId = harnessId;
              persistSessionToDb(paneId, harnessId);
              if (session.ws && session.ws.readyState === 1) {
                session.ws.send(JSON.stringify({ type: 'session-detected', sessionId: harnessId, paneId }));
              }
              return;
            }
          } catch (err) {
            // File might be half-written, try again next interval
            console.error(`[Session Detect] Gemini: error reading ${file}:`, err.message);
          }
        }
      }
    } catch { /* ignore */ }
  }, 2000);
}

function readFileHead(filePath, bytes) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(bytes);
    const bytesRead = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function readFilePrefix(filePath, maxBytes, minNewlines) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const chunks = [];
    let offset = 0;
    let newlineCount = 0;

    while (offset < maxBytes && newlineCount < minNewlines) {
      const toRead = Math.min(8192, maxBytes - offset);
      const buf = Buffer.alloc(toRead);
      const bytesRead = fs.readSync(fd, buf, 0, toRead, offset);
      if (bytesRead <= 0) break;

      const chunk = buf.subarray(0, bytesRead);
      chunks.push(chunk);
      offset += bytesRead;

      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0x0a) newlineCount++;
      }
    }

    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return '';
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function collectCodexRolloutFiles(dir, results) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCodexRolloutFiles(fullPath, results);
    } else if (entry.isFile() && /^rollout-.*\.jsonl$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
}

function readCodexSessionMeta(filePath) {
  try {
    const head = readFilePrefix(filePath, 256 * 1024, 1);
    const firstLine = head.split('\n').find((line) => line.trim().length > 0);
    if (!firstLine) return null;
    const parsed = JSON.parse(firstLine);
    const payload = parsed.payload || {};
    const sessionId = payload.id || parsed.session_id || null;
    const cwd = payload.cwd || parsed.cwd || null;
    return sessionId && cwd ? { sessionId, cwd } : null;
  } catch {
    return null;
  }
}

function detectNewCodexSession(paneId, cwd, ws, session, username) {
  const homeDir = getUserHome(username);
  const sessionsDir = path.join(homeDir, '.codex', 'sessions');
  const isWin = process.platform === 'win32';
  const resolvedCwd = path.resolve(cwd);
  const knownFiles = new Set();
  const startedAt = session.startedAt || Date.now();
  const recentFileSlackMs = 5000;

  try {
    const rolloutFiles = [];
    collectCodexRolloutFiles(sessionsDir, rolloutFiles);
    for (const file of rolloutFiles) knownFiles.add(file);
  } catch { /* ignore */ }

  console.log(`[Session Detect] Codex: scanning ${resolvedCwd} — snapshot ${knownFiles.size} existing rollout files`);

  let attempts = 0;
  const maxAttempts = 45;
  const interval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts || session.exited) {
      clearInterval(interval);
      return;
    }

    try {
      const rolloutFiles = [];
      collectCodexRolloutFiles(sessionsDir, rolloutFiles);

      for (const file of rolloutFiles) {
        const alreadyKnown = knownFiles.has(file);
        if (!alreadyKnown) knownFiles.add(file);

        let stat;
        try {
          stat = fs.statSync(file);
        } catch {
          continue;
        }

        // Codex can create the rollout file before the detector's initial snapshot
        // runs. Treat files touched right after this pane started as candidates too.
        const touchedAfterStart = stat.mtimeMs >= (startedAt - recentFileSlackMs);
        if (alreadyKnown && !touchedAfterStart) continue;

        const meta = readCodexSessionMeta(file);
        if (!meta) continue;

        const resolvedMetaCwd = path.resolve(meta.cwd);
        const sameCwd = isWin
          ? resolvedMetaCwd.toLowerCase() === resolvedCwd.toLowerCase()
          : resolvedMetaCwd === resolvedCwd;

        if (!sameCwd) continue;

        clearInterval(interval);
        console.log(`[Session Detect] Codex: detected session ${meta.sessionId} for ${resolvedCwd}`);
        session.detectedSessionId = meta.sessionId;
        persistSessionToDb(paneId, meta.sessionId);
        if (session.ws && session.ws.readyState === 1) {
          session.ws.send(JSON.stringify({ type: 'session-detected', sessionId: meta.sessionId, paneId }));
        }
        return;
      }
    } catch { /* ignore */ }
  }, 2000);
}

function detectNewForgeSession(paneId, cwd, ws, session, username) {
  const homeDir = getUserHome(username);
  const forgeDir = path.join(homeDir, '.forge');
  const convDir = path.join(forgeDir, 'conversations');

  const knownIds = new Set();
  const startedAt = session.startedAt || Date.now();
  const SLACK_MS = 5000;

  try {
    if (fs.existsSync(convDir)) {
      for (const file of fs.readdirSync(convDir)) {
        if (file.endsWith('.json')) {
          knownIds.add(path.basename(file, '.json'));
        }
      }
    }
  } catch { /* ignore */ }

  console.log(`[Session Detect] Forge: scanning conversations — snapshot ${knownIds.size} existing sessions`);

  let attempts = 0;
  const maxAttempts = 45;
  const interval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts || session.exited) {
      clearInterval(interval);
      return;
    }

    try {
      if (!fs.existsSync(convDir)) return;
      for (const file of fs.readdirSync(convDir)) {
        if (file.endsWith('.json')) {
          const id = path.basename(file, '.json');
          if (!knownIds.has(id)) {
            const fullPath = path.join(convDir, file);
            let stat;
            try { stat = fs.statSync(fullPath); } catch { continue; }
            
            // Verify file was created around the same time as the PTY
            if (stat.mtimeMs < (startedAt - SLACK_MS)) {
              knownIds.add(id);
              continue;
            }

            clearInterval(interval);
            console.log(`[Session Detect] Forge: detected session ${id} for pane ${paneId.slice(0, 8)}`);
            session.detectedSessionId = id;
            persistSessionToDb(paneId, id);
            if (session.ws && session.ws.readyState === 1) {
              session.ws.send(JSON.stringify({ type: 'session-detected', sessionId: id, paneId }));
            }
            return;
          }
        }
      }
    } catch { /* ignore */ }
  }, 2000);
}

// ─── Pi Coding Agent session detection ──────────────────
// Pi stores sessions as JSONL files in ~/.pi/agent/sessions/ (global)
// or .pi/sessions/ (project-level).  Scan both locations for new files
// that appeared after the PTY started.
function detectNewPiSession(paneId, cwd, ws, session, username) {
  const homeDir = getUserHome(username);
  const globalSessionsDir = path.join(homeDir, '.pi', 'agent', 'sessions');
  const projectSessionsDir = path.join(cwd, '.pi', 'sessions');

  const knownFiles = new Set();
  const startedAt = session.startedAt || Date.now();
  const SLACK_MS = 8000;

  // Snapshot existing session files so we only detect NEW ones
  for (const dir of [globalSessionsDir, projectSessionsDir]) {
    try {
      if (fs.existsSync(dir)) {
        for (const file of fs.readdirSync(dir)) {
          if (file.endsWith('.jsonl')) {
            knownFiles.add(path.join(dir, file));
          }
        }
      }
    } catch { /* ignore */ }
  }

  console.log(`[Session Detect] Pi: scanning sessions — snapshot ${knownFiles.size} existing files`);

  let attempts = 0;
  const maxAttempts = 45;
  const interval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts || session.exited) {
      clearInterval(interval);
      return;
    }

    for (const dir of [projectSessionsDir, globalSessionsDir]) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith('.jsonl')) continue;
          const fullPath = path.join(dir, file);
          if (knownFiles.has(fullPath)) continue;
          knownFiles.add(fullPath);

          let stat;
          try { stat = fs.statSync(fullPath); } catch { continue; }

          // Verify this session was created around the time our PTY started
          if (Math.abs(stat.mtimeMs - startedAt) > SLACK_MS) continue;

          // Try to read the first line for session metadata
          const head = readFileHead(fullPath, 4096);
          const firstLine = head.split('\n').find(l => l.trim().length > 0);
          if (!firstLine) continue;

          let sessionId;
          try {
            const entry = JSON.parse(firstLine);
            // Pi session files may have a session ID or use the filename
            sessionId = entry.sessionId || entry.id || path.basename(file, '.jsonl');
          } catch {
            sessionId = path.basename(file, '.jsonl');
          }

          clearInterval(interval);
          console.log(`[Session Detect] Pi: detected session ${sessionId} for pane ${paneId.slice(0, 8)}`);
          session.detectedSessionId = sessionId;
          persistSessionToDb(paneId, sessionId);
          if (session.ws && session.ws.readyState === 1) {
            session.ws.send(JSON.stringify({ type: 'session-detected', sessionId, paneId }));
          }
          return;
        }
      } catch { /* ignore */ }
    }
  }, 2000);
}

module.exports = { createTerminalServer, getRuntime, setFederationContext, getFederationContext, waitForApi, isApiReady };

