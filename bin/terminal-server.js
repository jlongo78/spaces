#!/usr/bin/env node

const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.SPACES_WS_PORT || '3458', 10);
const SPACES_TIER = process.env.SPACES_TIER || 'community';
// API_PORT is the port where Next.js API routes are reachable.
// In attached mode, createTerminalServer() updates this to the parent server's port.
let API_PORT = parseInt(process.env.SPACES_PORT || '3457', 10);

// Track whether the Next.js API is ready — avoids timeout spam during startup
let _apiReady = false;
function setApiReady() { _apiReady = true; }
function isApiReady() { return _apiReady; }
// Poll until the API responds, then mark ready
function waitForApi() {
  const check = () => {
    const req = http.get(`http://localhost:${API_PORT}/api/tier`, { timeout: 1000 }, (res) => {
      res.resume(); // consume body to free socket
      if (res.statusCode < 500) { setApiReady(); return; }
      setTimeout(check, 2000);
    });
    req.on('error', () => setTimeout(check, 2000));
    req.on('timeout', () => { req.destroy(); setTimeout(check, 2000); });
  };
  setTimeout(check, 1000);
}

// ─── Terminal token verification ──────────────────────────

const SECRET_PATH = path.join(os.homedir(), '.spaces', 'terminal_secret');

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

const SESSION_SECRET_PATH = path.join(os.homedir(), '.spaces', 'session_secret');

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

const ADMIN_DB_PATH = path.join(os.homedir(), '.spaces', 'admin.db');
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

const NETWORK_DB_PATH = path.join(os.homedir(), '.spaces', 'network.db');
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

function getNodeInfo(nodeId) {
  const db = getNetworkDb();
  if (!db) return null;
  try {
    return db.prepare('SELECT * FROM nodes WHERE id = ?').get(nodeId);
  } catch {
    return null;
  }
}

function decryptNodeApiKey(encrypted) {
  try {
    const key = Buffer.from(fs.readFileSync(SECRET_PATH, 'utf-8').trim(), 'hex');
    const [ivB64, tagB64, dataB64] = encrypted.split(':');
    if (!ivB64 || !tagB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8');
  } catch {
    return null;
  }
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

// ─── SSH service key path (used to spawn shells as other OS users) ──

const SERVICE_KEY = path.join(os.homedir(), '.spaces', 'service_key');

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

  // Append key and fix permissions
  const tmpFile = `/tmp/spaces-authkey-${shellUser}-${Date.now()}`;
  fs.writeFileSync(tmpFile, existing + pubKey + '\n');
  spawnSync('sudo', ['cp', tmpFile, authKeysPath], { stdio: 'pipe', timeout: 5000 });
  spawnSync('sudo', ['chmod', '600', authKeysPath], { stdio: 'pipe', timeout: 5000 });
  spawnSync('sudo', ['chown', `${shellUser}:${shellUser}`, authKeysPath], { stdio: 'pipe', timeout: 5000 });
  try { fs.unlinkSync(tmpFile); } catch {}

  console.log('[SSH] Authorized service key for user ' + shellUser);
}
try { ensureServiceKeyAtRuntime(); } catch (e) { console.error('[SSH] Key setup failed (non-fatal):', e.message); }

// Session store: keeps ptys alive across WebSocket reconnections
// Key: paneId, Value: { pty, ws (current WebSocket or null), buffer (rolling output), username }
const sessions = new Map();

const MAX_BUFFER_LINES = 500;

// ─── Agent definitions (mirrors src/lib/agents.ts) ────────
const AGENTS = {
  shell:  { command: '',       resumeFlag: '',         resumeStyle: '' },
  claude: { command: 'claude', resumeFlag: '--resume', resumeStyle: 'flag' },
  codex:  { command: 'codex',  resumeFlag: 'resume',   resumeStyle: 'subcommand' },
  gemini: { command: 'gemini', resumeFlag: '--resume', resumeStyle: 'flag' },
  aider:  { command: 'aider',  resumeFlag: '',         resumeStyle: '' },
  forge:  { command: 'forge',  resumeFlag: '--cid',    resumeStyle: 'flag' },
  custom: { command: '',       resumeFlag: '',         resumeStyle: '' },
};

const SESSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-_.]*$/;

// ─── Remove Cortex hooks from Claude Code config ─────────
function removeCortexHookConfig(cwd) {
  try {
    const settingsPath = path.join(cwd, '.claude', 'settings.local.json');
    if (!fs.existsSync(settingsPath)) return;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    let changed = false;

    // Remove cortex hooks from UserPromptSubmit and Stop
    if (settings.hooks?.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
        (g) => !g.hooks?.some((h) => h.command?.includes('cortex-hook'))
      );
      if (settings.hooks.UserPromptSubmit.length === 0) delete settings.hooks.UserPromptSubmit;
      changed = true;
    }
    if (settings.hooks?.Stop) {
      settings.hooks.Stop = settings.hooks.Stop.filter(
        (g) => !g.hooks?.some((h) => h.command?.includes('cortex-learn-hook'))
      );
      if (settings.hooks.Stop.length === 0) delete settings.hooks.Stop;
      changed = true;
    }

    // Remove cortex MCP server
    if (settings.mcpServers?.cortex) {
      delete settings.mcpServers.cortex;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      console.log(`[Cortex] Removed hooks and MCP server from ${settingsPath}`);
    }

    // Remove spaces-env.json
    const envFile = path.join(cwd, '.claude', 'spaces-env.json');
    if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
  } catch (err) {
    console.error(`[Cortex] Failed to remove hook config:`, err.message);
  }
}

// ─── Cortex Claude Code hook config ──────────────────────
// Write a UserPromptSubmit hook into .claude/settings.local.json
// so every prompt gets a RAG search before Claude sees it.
function writeCortexHookConfig(cwd, paneId) {
  try {
    const claudeDir = path.join(cwd, '.claude');
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });

    const settingsPath = path.join(claudeDir, 'settings.local.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
    }

    // Resolve hook paths from workspace bin/ first, then fall back to managed package
    let ragHook = path.resolve(__dirname, 'cortex-hook.js');
    let learnHook = path.resolve(__dirname, 'cortex-learn-hook.js');

    if (!fs.existsSync(ragHook) || !fs.existsSync(learnHook)) {
      try {
        const cortexDir = path.dirname(require.resolve('@spaces/cortex'));
        if (!fs.existsSync(ragHook)) ragHook = path.join(cortexDir, 'hooks', 'cortex-hook.js');
        if (!fs.existsSync(learnHook)) learnHook = path.join(cortexDir, 'hooks', 'cortex-learn-hook.js');
      } catch {
        // Fallback to __dirname (already set above)
      }
    }

    // Merge — don't clobber existing hooks for other events
    if (!settings.hooks) settings.hooks = {};

    // Bake env vars into hook commands so they're always available
    // (Claude Code hook subprocesses may not inherit the PTY env)
    const hookEnv = `SPACES_PORT=${API_PORT} SPACES_SESSION_SECRET="${process.env.SPACES_SESSION_SECRET || ''}"`;

    // RAG search: runs on every prompt, injects relevant context
    settings.hooks.UserPromptSubmit = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${ragHook}"`,
            timeout: 15,
          },
        ],
      },
    ];

    // Learn: runs after Claude finishes, ingests the exchange back into Cortex
    settings.hooks.Stop = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${learnHook}"`,
            timeout: 10,
          },
        ],
      },
    ];

    // Refresh SessionStart hook with current pane ID (prevents stale ID errors)
    if (paneId) {
      try {
        const teamsHook = path.join(os.homedir(), '.spaces', 'packages', 'teams', 'bin', 'spaces-hook.js');
        if (fs.existsSync(teamsHook)) {
          settings.hooks.SessionStart = [
            {
              hooks: [
                {
                  type: 'command',
                  command: `node "${teamsHook}" ${paneId}`,
                  timeout: 10000,
                },
              ],
            },
          ];
        }
      } catch { /* teams not installed */ }
    }

    // Register Cortex MCP server
    const mcpServer = path.resolve(__dirname, 'cortex-mcp.js');
    if (!settings.mcpServers) settings.mcpServers = {};
    settings.mcpServers.cortex = {
      command: 'node',
      args: [mcpServer],
      env: {
        SPACES_URL: `http://localhost:${API_PORT}`,
        SPACES_INTERNAL_TOKEN: (process.env.SPACES_SESSION_SECRET || '').slice(0, 16),
      },
    };

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log(`[Cortex] Wrote Claude Code hooks (RAG + Learn) + MCP server to ${settingsPath}`);
  } catch (err) {
    console.error(`[Cortex] Failed to write hook config:`, err.message);
  }
}

// ─── Remove Cortex config from Gemini CLI ────────────────
function removeGeminiCortexConfig(cwd) {
  try {
    const settingsPath = path.join(cwd, '.gemini', 'settings.json');
    if (!fs.existsSync(settingsPath)) return;
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    let changed = false;

    // Remove cortex hooks from BeforeAgent and SessionEnd
    if (settings.hooks?.BeforeAgent) {
      settings.hooks.BeforeAgent = settings.hooks.BeforeAgent.filter(
        (g) => !g.hooks?.some((h) => h.command?.includes('cortex-hook'))
      );
      if (settings.hooks.BeforeAgent.length === 0) delete settings.hooks.BeforeAgent;
      changed = true;
    }
    if (settings.hooks?.SessionEnd) {
      settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
        (g) => !g.hooks?.some((h) => h.command?.includes('cortex-learn-hook'))
      );
      if (settings.hooks.SessionEnd.length === 0) delete settings.hooks.SessionEnd;
      changed = true;
    }

    if (settings.mcpServers?.cortex) {
      delete settings.mcpServers.cortex;
      changed = true;
    }

    if (changed) {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
      console.log(`[Cortex] Removed hooks and MCP from ${settingsPath}`);
    }

    const envFile = path.join(cwd, '.gemini', 'spaces-env.json');
    if (fs.existsSync(envFile)) fs.unlinkSync(envFile);
  } catch (err) {
    console.error(`[Cortex] Failed to remove Gemini config:`, err.message);
  }
}

// ─── Cortex Gemini CLI config ────────────────────────────
// Write BeforeAgent hook (Gemini's UserPromptSubmit equivalent)
// + SessionEnd hook (learn) + Cortex MCP server into .gemini/settings.json.
// The same cortex-hook.js works — Gemini ignores the extra hookEventName field.
function writeGeminiCortexConfig(cwd) {
  try {
    const geminiDir = path.join(cwd, '.gemini');
    if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });

    const settingsPath = path.join(geminiDir, 'settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
    }

    // Resolve hook paths from workspace bin/ first, then fall back to managed package
    let ragHook = path.resolve(__dirname, 'cortex-hook.js');
    let learnHook = path.resolve(__dirname, 'cortex-learn-hook.js');

    if (!fs.existsSync(ragHook) || !fs.existsSync(learnHook)) {
      try {
        const cortexDir = path.dirname(require.resolve('@spaces/cortex'));
        if (!fs.existsSync(ragHook)) ragHook = path.join(cortexDir, 'hooks', 'cortex-hook.js');
        if (!fs.existsSync(learnHook)) learnHook = path.join(cortexDir, 'hooks', 'cortex-learn-hook.js');
      } catch {
        // Fallback to __dirname (already set above)
      }
    }

    const isWin = process.platform === 'win32';
    const secret = process.env.SPACES_SESSION_SECRET || '';
    const hookEnv = isWin
      ? `set SPACES_PORT=${API_PORT} && set SPACES_SESSION_SECRET=${secret} &&`
      : `SPACES_PORT=${API_PORT} SPACES_SESSION_SECRET="${secret}"`;

    if (!settings.hooks) settings.hooks = {};

    // BeforeAgent: fires after user submits prompt, before Gemini plans — injects RAG context
    settings.hooks.BeforeAgent = [
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: `node "${ragHook}"`,
            timeout: 15000,  // Gemini uses milliseconds
          },
        ],
      },
    ];

    // AfterAgent: fires once per turn after the agent generates its response — learn from the turn
    settings.hooks.AfterAgent = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${learnHook}"`,
            timeout: 10000,
          },
        ],
      },
    ];

    // SessionEnd: fires when session ends — final ingestion safety net
    settings.hooks.SessionEnd = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${learnHook}"`,
            timeout: 10000,
          },
        ],
      },
    ];

    // Register Cortex MCP server (for on-demand tool access)
    const mcpServer = path.resolve(__dirname, 'cortex-mcp.js');
    if (!settings.mcpServers) settings.mcpServers = {};
    settings.mcpServers.cortex = {
      command: 'node',
      args: [mcpServer],
      env: {
        SPACES_URL: `http://localhost:${API_PORT}`,
        SPACES_INTERNAL_TOKEN: (process.env.SPACES_SESSION_SECRET || '').slice(0, 16),
      },
    };

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log(`[Cortex] Wrote Gemini CLI hooks (BeforeAgent + SessionEnd) + MCP to ${settingsPath}`);
  } catch (err) {
    console.error(`[Cortex] Failed to write Gemini config:`, err.message);
  }
}

// ─── Remove Cortex config from Codex CLI ─────────────────
function normalizeTomlSpacing(content) {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}

function stripTomlSection(lines, tableName) {
  const out = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isHeader = trimmed.startsWith('[') && trimmed.endsWith(']');
    const isTargetHeader = trimmed === `[${tableName}]` || trimmed.startsWith(`[${tableName}.`);

    if (isTargetHeader) {
      skipping = true;
      continue;
    }

    if (skipping && isHeader) {
      skipping = false;
    }

    if (!skipping) out.push(line);
  }

  return out;
}

function removeTomlTableTree(content, tableName) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return stripTomlSection(lines, tableName).join('\n');
}

function upsertTomlTable(content, tableName, body) {
  const cleaned = removeTomlTableTree(content, tableName).trim();
  const block = [`[${tableName}]`, ...body, ''].join('\n');
  return cleaned ? `${cleaned}\n\n${block}` : `${block}\n`;
}

function removeTomlKey(content, tableName, key) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isHeader = trimmed.startsWith('[') && trimmed.endsWith(']');

    if (isHeader) {
      inTable = trimmed === `[${tableName}]`;
      out.push(line);
      continue;
    }

    if (inTable && new RegExp(`^${key}\\s*=`).test(trimmed)) continue;
    out.push(line);
  }

  return out.join('\n');
}

function upsertTomlKey(content, tableName, key, value) {
  let toml = removeTomlKey(content, tableName, key);
  const lines = toml.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inTable = false;
  let inserted = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isHeader = trimmed.startsWith('[') && trimmed.endsWith(']');

    if (isHeader) {
      if (inTable && !inserted) {
        out.push(`${key} = ${value}`);
        inserted = true;
      }
      inTable = trimmed === `[${tableName}]`;
      out.push(line);
      continue;
    }

    out.push(line);
  }

  if (!inserted) {
    if (lines.some((line) => line.trim() === `[${tableName}]`)) {
      out.push(`${key} = ${value}`);
    } else {
      if (out.length && out[out.length - 1].trim() !== '') out.push('');
      out.push(`[${tableName}]`);
      out.push(`${key} = ${value}`);
    }
  }

  return out.join('\n');
}

function removeCodexCortexConfig(cwd) {
  try {
    // Remove hooks from hooks.json (Codex stores hooks separately)
    const hooksPath = path.join(cwd, '.codex', 'hooks.json');
    if (fs.existsSync(hooksPath)) {
      const hooksConfig = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
      let changed = false;
      if (hooksConfig.hooks?.UserPromptSubmit) {
        hooksConfig.hooks.UserPromptSubmit = hooksConfig.hooks.UserPromptSubmit.filter(
          (g) => !g.hooks?.some((h) => h.command?.includes('cortex-hook'))
        );
        if (hooksConfig.hooks.UserPromptSubmit.length === 0) delete hooksConfig.hooks.UserPromptSubmit;
        changed = true;
      }
      if (hooksConfig.hooks?.Stop) {
        hooksConfig.hooks.Stop = hooksConfig.hooks.Stop.filter(
          (g) => !g.hooks?.some((h) => h.command?.includes('cortex-learn-hook'))
        );
        if (hooksConfig.hooks.Stop.length === 0) delete hooksConfig.hooks.Stop;
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(hooksPath, JSON.stringify(hooksConfig, null, 2), 'utf-8');
      }
    }

    // Remove MCP + hooks feature flag from project-scoped config.toml
    const configPath = path.join(cwd, '.codex', 'config.toml');
    if (fs.existsSync(configPath)) {
      let toml = fs.readFileSync(configPath, 'utf-8');
      toml = removeTomlTableTree(toml, 'mcp_servers.cortex');
      toml = removeTomlKey(toml, 'features', 'codex_hooks');
      fs.writeFileSync(configPath, normalizeTomlSpacing(toml), 'utf-8');
    }

    // Remove legacy MCP config.json written by older Spaces builds.
    const legacyConfigPath = path.join(cwd, '.codex', 'config.json');
    if (fs.existsSync(legacyConfigPath)) fs.unlinkSync(legacyConfigPath);

    const envFile = path.join(cwd, '.codex', 'spaces-env.json');
    if (fs.existsSync(envFile)) fs.unlinkSync(envFile);

    console.log(`[Cortex] Removed Codex CLI hooks and MCP config`);
  } catch (err) {
    console.error(`[Cortex] Failed to remove Codex config:`, err.message);
  }
}

// ─── Cortex Codex CLI config ─────────────────────────────
// Write UserPromptSubmit + Stop hooks into .codex/hooks.json (Codex uses
// the SAME event names and I/O format as Claude Code — the cortex-hook.js
// output is directly compatible).  MCP server goes in .codex/config.json.
// NOTE: Codex hooks are not yet supported on Windows — the MCP server
// and .spaces/cortex-context.md serve as fallbacks there.
function writeCodexCortexConfig(cwd) {
  try {
    const codexDir = path.join(cwd, '.codex');
    if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });

    // Resolve hook paths from workspace bin/ first, then fall back to managed package
    let ragHook = path.resolve(__dirname, 'cortex-hook.js');
    let learnHook = path.resolve(__dirname, 'cortex-learn-hook.js');

    if (!fs.existsSync(ragHook) || !fs.existsSync(learnHook)) {
      try {
        const cortexDir = path.dirname(require.resolve('@spaces/cortex'));
        if (!fs.existsSync(ragHook)) ragHook = path.join(cortexDir, 'hooks', 'cortex-hook.js');
        if (!fs.existsSync(learnHook)) learnHook = path.join(cortexDir, 'hooks', 'cortex-learn-hook.js');
      } catch {
        // Fallback to __dirname (already set above)
      }
    }

    // ── Hooks (separate hooks.json — Codex convention) ──
    const hooksPath = path.join(codexDir, 'hooks.json');
    let hooksConfig = {};
    if (fs.existsSync(hooksPath)) {
      try { hooksConfig = JSON.parse(fs.readFileSync(hooksPath, 'utf-8')); } catch {}
    }
    if (!hooksConfig.hooks) hooksConfig.hooks = {};

    // UserPromptSubmit — same event name as Claude Code
    hooksConfig.hooks.UserPromptSubmit = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${ragHook}"`,
            timeout: 5,  // Codex uses seconds
          },
        ],
      },
    ];

    // Stop — same event name as Claude Code
    hooksConfig.hooks.Stop = [
      {
        hooks: [
          {
            type: 'command',
            command: `node "${learnHook}"`,
            timeout: 10,
          },
        ],
      },
    ];

    fs.writeFileSync(hooksPath, JSON.stringify(hooksConfig, null, 2), 'utf-8');

    // ── MCP server (config.json) ──
    const tomlPath = path.join(codexDir, 'config.toml');
    let toml = '';
    if (fs.existsSync(tomlPath)) {
      toml = fs.readFileSync(tomlPath, 'utf-8');
    }
    const mcpServer = path.resolve(__dirname, 'cortex-mcp.js');
    toml = upsertTomlKey(toml, 'features', 'codex_hooks', 'true');
    toml = upsertTomlTable(toml, 'mcp_servers.cortex', [
      'command = "node"',
      `args = ["${mcpServer.replace(/\\/g, '\\\\')}"]`,
      `env = { SPACES_URL = "http://localhost:${API_PORT}", SPACES_INTERNAL_TOKEN = "${(process.env.SPACES_SESSION_SECRET || '').slice(0, 16)}" }`,
    ]);
    fs.writeFileSync(tomlPath, normalizeTomlSpacing(toml), 'utf-8');

    const legacyConfigPath = path.join(codexDir, 'config.json');
    if (fs.existsSync(legacyConfigPath)) fs.unlinkSync(legacyConfigPath);

    console.log(`[Cortex] Wrote Codex CLI hooks + MCP to ${codexDir}`);
  } catch (err) {
    console.error(`[Cortex] Failed to write Codex config:`, err.message);
  }
}

// ─── Cortex context injection ────────────────────────────
// Fetch relevant knowledge from Cortex API and write a context file
// in the workspace before the agent launches.
async function injectCortexContext(cwd, workspaceId, ws) {
  if (!isApiReady()) return 0;
  if (SPACES_TIER !== 'team' && SPACES_TIER !== 'federation') return 0;
  // Check if Cortex is actually enabled in user config
  try {
    const configPath = path.join(os.homedir(), '.spaces', 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (!cfg.cortex?.enabled) return 0;
    } else {
      return 0;
    }
  } catch { return 0; }
  try {
    const projectName = path.basename(cwd);
    const query = encodeURIComponent(`${projectName} workspace context`);
    const params = `q=${query}&limit=10${workspaceId ? `&workspace_id=${workspaceId}` : ''}`;
    const url = `http://localhost:${API_PORT}/api/cortex/search?${params}`;

    // Use internal auth bypass (x-spaces-internal header) to skip session middleware
    const internalToken = (process.env.SPACES_SESSION_SECRET || '').slice(0, 16);
    const options = {
      timeout: 15000,
      headers: {
        'x-spaces-internal': internalToken,
      },
    };

    const body = await new Promise((resolve, reject) => {
      const req = http.get(url, options, (res) => {
        // Follow redirects (Next.js trailing-slash redirects)
        if (res.statusCode === 308 || res.statusCode === 307 || res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location;
          if (redirectUrl) {
            const fullUrl = redirectUrl.startsWith('http') ? redirectUrl : `http://localhost:${API_PORT}${redirectUrl}`;
            const req2 = http.get(fullUrl, options, (res2) => {
              let data = '';
              res2.on('data', (chunk) => { data += chunk; });
              res2.on('end', () => {
                if (res2.statusCode !== 200) {
                  reject(new Error(`Cortex API returned ${res2.statusCode}: ${data.slice(0, 200)}`));
                } else {
                  resolve(data);
                }
              });
            });
            req2.on('error', reject);
            return;
          }
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Cortex API returned ${res.statusCode}: ${data.slice(0, 200)}`));
          } else {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });

    const parsed = JSON.parse(body);
    const results = parsed.results;
    if (!results || results.length === 0) {
      console.log(`[Cortex] No knowledge found for "${projectName}"`);
      return 0;
    }

    // Format context (mirrors src/lib/cortex/retrieval/injection.ts)
    const TYPE_LABELS = {
      decision: 'Decision', pattern: 'Pattern', preference: 'Preference',
      error_fix: 'Error Fix', context: 'Context', code_pattern: 'Code',
      command: 'Command', conversation: 'Conversation', summary: 'Summary',
    };
    const lines = ['<cortex-context>', 'Relevant context from your workspace history:', ''];
    let tokens = 20;
    const included = [];
    for (const unit of results) {
      const label = TYPE_LABELS[unit.type] || unit.type;
      const date = (unit.source_timestamp || '').slice(0, 10);
      const confidence = (unit.confidence * 100).toFixed(0);
      let entry = `[${label}]`;
      if (date) entry += ` ${date}:`;
      entry += ` ${unit.text}`;
      if (unit.session_id) entry += `\nSource: session ${unit.session_id}, confidence: ${confidence}%`;
      const entryTokens = Math.ceil(entry.length / 4);
      if (tokens + entryTokens > 2000) break;
      lines.push(entry, '');
      tokens += entryTokens;
      included.push({ type: unit.type, text: unit.text.slice(0, 80) });
    }
    lines.push('</cortex-context>');

    // Write context file (readable artifact for any agent)
    const spacesDir = path.join(cwd, '.spaces');
    if (!fs.existsSync(spacesDir)) fs.mkdirSync(spacesDir, { recursive: true });
    fs.writeFileSync(path.join(spacesDir, 'cortex-context.md'), lines.join('\n'), 'utf-8');
    console.log(`[Cortex] Injected ${included.length} knowledge units for ${path.basename(cwd)}`);

    // Notify client for injection badge
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'cortex-injection', count: included.length, items: included }));
    }

    return included.length;
  } catch (err) {
    console.error(`[Cortex] Injection failed:`, err.message);
    return 0;
  }
}

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
    const result = require('child_process').execSync('where bash.exe 2>nul', { encoding: 'utf-8', timeout: 3000 });
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
    const result = require('child_process').execSync('where ssh.exe 2>nul', { encoding: 'utf-8', timeout: 3000 });
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
    // Allow configured hostname from env (e.g., spaces.example.com)
    const allowed = process.env.SPACES_ALLOWED_ORIGINS;
    if (allowed) {
      return allowed.split(',').some(h => url.hostname === h.trim());
    }
    // In non-community modes, require explicit allowed origins
    if (SPACES_TIER !== 'community') return false;
    // Desktop/community: allow any origin
    return true;
  } catch {
    return false;
  }
}

// ─── Live collab toggle handler ─────────────────────────
function handleCollabToggle(paneId, session) {
  try {
    const teams = require('@spaces/teams');
    const config = teams.terminal.getCollabConfig(paneId, session.username);

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
      teams.terminal.writeAgentConfig(session.agentType, session.cwd, env);

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
  // Sanitize: reject shell metacharacters that enable injection (;, |, &, $, `, etc.)
  const customCommand = /[;&|`$(){}]/.test(rawCustomCommand) ? '' : rawCustomCommand;
  const cols = parseInt(url.searchParams.get('cols') || '120', 10);
  const rows = parseInt(url.searchParams.get('rows') || '30', 10);

  // Authenticate: try session cookie first (self-contained auth), then terminal token + SSO header
  let username = null;
  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['spaces-session'];
  const sessionPayload = sessionToken ? verifySessionToken(sessionToken) : null;

  console.log(`[Auth] pane=${paneId.slice(0, 8)} cookie=${sessionToken ? 'present' : 'MISSING'} sessionValid=${!!sessionPayload} terminalToken=${(url.searchParams.get('terminalToken') || '').slice(0, 12) || 'NONE'} nodeId=${url.searchParams.get('nodeId') || 'NONE'} apiKey=${url.searchParams.get('apiKey') ? 'present' : 'NONE'}`);

  if (sessionPayload) {
    // Self-contained auth: session cookie is valid
    username = sessionPayload.sub;
    console.log(`[Auth] Authenticated via session cookie: ${username}`);
  } else {
    const terminalToken = url.searchParams.get('terminalToken') || '';

    // Accept magic tokens from desktop/community tier, or from trusted local proxies (Docker/localhost)
    const remoteIp = req.socket.remoteAddress || '';
    const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1' || remoteIp.startsWith('172.') || remoteIp.startsWith('::ffff:172.');
    if ((terminalToken === 'desktop-local' || terminalToken === 'session-auth') && (SPACES_TIER === 'desktop' || SPACES_TIER === 'community' || isLocal)) {
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
      console.log(`[Auth] Authenticated via desktop token: ${username}`);
    } else {
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

  // Internal token auth (for VR client and other trusted local processes)
  if (!username) {
    const internalToken = url.searchParams.get('internal') || '';
    const expectedToken = (process.env.SPACES_SESSION_SECRET || '').slice(0, 16);
    if (internalToken && expectedToken && internalToken === expectedToken) {
      const remoteIp = req.socket.remoteAddress || '';
      const isLocal = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1' || remoteIp.includes('192.168.') || remoteIp.includes('::ffff:192.168.');
      if (isLocal) {
        username = os.userInfo().username;
        console.log(`[Auth] Authenticated via internal token (VR): ${username}`);
      }
    }
  }

  // Network API key auth (for proxied connections from remote nodes)
  if (!username) {
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

  // Proxy to remote node (federation tier only)
  const nodeId = url.searchParams.get('nodeId');
  if (nodeId) {
    if (SPACES_TIER !== 'federation') {
      ws.send(JSON.stringify({ type: 'error', data: 'Remote workspaces require the Federation tier' }));
      ws.close();
      return;
    }
    handleProxyConnection(ws, nodeId, { paneId, cwd, agentType, agentSession, customCommand, cols, rows });
    return;
  }

  // Check for existing session to reattach
  const existing = sessions.get(paneId);
  if (existing && existing.pty && !existing.exited) {
    console.log(`[WS] Reattach pane=${paneId.slice(0,8)} buffer=${existing.buffer.length} chunks`);
    existing.ws = ws;

    // Replay buffered output so user sees context
    for (const chunk of existing.buffer) {
      ws.send(JSON.stringify({ type: 'data', data: chunk }));
    }

    try { existing.pty.resize(cols, rows); } catch { /* ignore */ }

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

    // Skip Cortex injection on reattach — context was already injected at spawn.
    // The badge polls /api/cortex/status independently.

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'data') {
          existing.pty.write(msg.data);
        } else if (msg.type === 'resize') {
          try { existing.pty.resize(msg.cols, msg.rows); } catch { /* ignore */ }
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

  // Create new pty session
  const isWindows = process.platform === 'win32';

  // Resolve the OS shell user for this app user
  const shellUser = lookupShellUser(username);
  const processUser = os.userInfo().username;
  let shell, args;
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
    shell = sshBin;
    args = [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${path.join(os.homedir(), '.spaces', 'known_hosts')}`,
      '-i', SERVICE_KEY,
      '-t',
      `${shellUser}@localhost`,
    ];
    // Force IPv4 — localhost may resolve to ::1 (IPv6) which sshd can reject
    args.unshift('-4');

    // On-demand SSH provisioning: ensure the shell user's authorized_keys is set up
    // before attempting the connection. This handles users added after service install.
    if (process.platform !== 'win32' && fs.existsSync(SERVICE_KEY + '.pub')) {
      try {
        const pubKey = fs.readFileSync(SERVICE_KEY + '.pub', 'utf-8').trim();
        authorizeShellUser(shellUser, pubKey);
      } catch (e) {
        console.error(`[SSH] On-demand provisioning for ${shellUser} failed (non-fatal):`, e.message);
      }
    }
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

  const env = { ...process.env };
  delete env.CLAUDECODE;
  // Enable prompt suggestions in spawned Claude Code sessions
  env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = 'true';
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

  // Inject Spaces bus environment for agent communication
  env.SPACES_PANE_ID = paneId;
  env.SPACES_API_URL = `http://localhost:${API_PORT}`;

  // Look up workspace collaboration config from @spaces/teams
  let isCollaborating = false;
  try {
    const teams = require('@spaces/teams');
    const config = teams.terminal.getCollabConfig(paneId, username);
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

  console.log(`[Spawn] user=${username} shell=${shell} args=${JSON.stringify(args)} cwd=${safeCwd} agentType=${agentType}`);

  // Write Cortex config before spawning (hooks for Claude, MCP for Gemini/Codex)
  if (['claude', 'gemini', 'codex'].includes(agentType) && (SPACES_TIER === 'team' || SPACES_TIER === 'federation')) {
    try {
      const userHome = getUserHome(username);
      const configPath = path.join(userHome, '.spaces', 'config.json');
      let cortexEnabled = false;
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        cortexEnabled = cfg.cortex?.enabled === true;
      }
      if (!cortexEnabled) {
        if (agentType === 'claude') removeCortexHookConfig(safeCwd);
        else if (agentType === 'gemini') removeGeminiCortexConfig(safeCwd);
        else if (agentType === 'codex') removeCodexCortexConfig(safeCwd);
      } else {
        // Resolve workspace ID: from collab config, or look up from pane DB
        let wsId = env.SPACES_WORKSPACE_ID || null;
        if (!wsId) {
          try {
            const Database = require('better-sqlite3');
            const spacesDb = new Database(path.join(getUserHome(username), '.spaces', 'spaces.db'), { readonly: true });
            const row = spacesDb.prepare('SELECT workspace_id FROM panes WHERE id = ?').get(paneId);
            if (row && row.workspace_id) wsId = String(row.workspace_id);
            spacesDb.close();
          } catch { /* non-fatal */ }
        }
        if (wsId) env.SPACES_WORKSPACE_ID = wsId;

        if (agentType === 'claude') {
          writeCortexHookConfig(safeCwd, paneId);
          // Write workspace ID for hooks to read (they can't inherit PTY env)
          try {
            const envFile = path.join(safeCwd, '.claude', 'spaces-env.json');
            fs.writeFileSync(envFile, JSON.stringify({
              workspaceId: wsId,
              port: API_PORT,
            }), 'utf-8');
          } catch { /* non-fatal */ }
        } else if (agentType === 'gemini') {
          writeGeminiCortexConfig(safeCwd);
          try {
            const envFile = path.join(safeCwd, '.gemini', 'spaces-env.json');
            fs.writeFileSync(envFile, JSON.stringify({
              workspaceId: wsId,
              port: API_PORT,
            }), 'utf-8');
          } catch { /* non-fatal */ }
        } else if (agentType === 'codex') {
          writeCodexCortexConfig(safeCwd);
          try {
            const envFile = path.join(safeCwd, '.codex', 'spaces-env.json');
            fs.writeFileSync(envFile, JSON.stringify({
              workspaceId: wsId,
              port: API_PORT,
            }), 'utf-8');
          } catch { /* non-fatal */ }
        }
      }
    } catch (e) {
      console.error('[Cortex] Config check failed (non-fatal):', e.message);
    }
  }

  let term;
  try {
    term = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: safeCwd,
      env,
    });
  } catch (err) {
    console.error(`[Spawn Error] ${err.message} (cwd=${cwd}, shell=${shell})`);
    ws.send(JSON.stringify({ type: 'error', data: 'Failed to spawn terminal session' }));
    ws.close();
    return;
  }

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

  // ─── Cortex context injection (async, non-blocking) ─────
  if (agentType !== 'shell') {
    injectCortexContext(safeCwd, env.SPACES_WORKSPACE_ID || null, ws).catch(() => {});
  }

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

  // Write collaboration config for agent panes via @spaces/teams
  if (isCollaborating && agentType !== 'shell') {
    try {
      const teams = require('@spaces/teams');
      teams.terminal.writeAgentConfig(agentType, safeCwd, env);
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
        if (agentType === 'claude') {
          // Claude needs to be run from the correct project CWD
          const sessionCwd = findSessionCwd(agentSession, username);

          // Verify the session actually exists on disk before attempting resume.
          // If the .jsonl file is gone (server restart, cleanup, etc.), fall back
          // to starting fresh so the user doesn't see "No conversation found".
          const sessionExists = sessionCwd !== null || findSessionFile(agentSession, username);

          if (!sessionExists) {
            console.log(`[Resume] Session ${agentSession.slice(0, 8)} not found on disk — starting fresh for pane ${paneId.slice(0, 8)}`);
            // Clear the stale session ID from the DB
            persistSessionToDb(paneId, 'new');
            setTimeout(() => {
              if (!session.exited) {
                term.write(`${command}\r`);
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
          setTimeout(() => {
            if (!session.exited) {
              term.write(`${command} ${agent.resumeFlag} ${agentSession}\r`);
            }
          }, delay);
        }
      } else {
        // Start new session
        setTimeout(() => {
          if (!session.exited) {
            term.write(`${command}\r`);
          }
        }, delay);
      }
    }
  }

  // pty -> ws (and buffer)
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

  term.onExit(({ exitCode }) => {
    session.exited = true;
    analyticsRecordSessionEnd(paneId);
    // Clean up hook state file
    try {
      const hookStateFile = path.join(os.homedir(), '.spaces', 'hook-state', `${paneId}.json`);
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
  } else if (agentType === 'codex' && (!agentSession || agentSession === 'new')) {
    detectNewCodexSession(paneId, cwd, ws, session, username);
  } else if (agentType === 'gemini') {
    detectNewGeminiSession(paneId, cwd, ws, session, username);
  } else if (agentType === 'forge') {
    detectNewForgeSession(paneId, cwd, ws, session, username);
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
 * e.g. "C:\projects\spaces-cortex" → "C--projects-spaces-cortex"
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
        // (e.g. "spaces-cortex") are indistinguishable from path separators
        // in the encoded form. Only use this if the .jsonl had no cwd field.
        let derivedPath;
        const winDriveMatch = projDir.name.match(/^([A-Za-z])--(.*)/);
        if (winDriveMatch) {
          // Windows: "C--projects-spaces-cortex" → try "C:\projects\spaces-cortex" etc.
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
 * Persist a detected Claude session ID to the database via the Next.js API.
 * This is the critical reliability fix: even if the WebSocket message to the
 * frontend is lost (tab backgrounded, network glitch, etc.), the DB is updated
 * so that workspace-load and page-refresh will use `claude --resume <id>`.
 */
function persistSessionToDb(paneId, sessionId, _retries) {
  const retries = _retries || 0;
  if (!isApiReady()) {
    console.log(`[Session Persist] API not ready, retrying in 2s for pane ${paneId.slice(0, 8)}`);
    if (retries < 5) setTimeout(() => persistSessionToDb(paneId, sessionId, retries + 1), 2000);
    return;
  }
  const internalToken = (process.env.SPACES_SESSION_SECRET || '').slice(0, 16);
  const payload = JSON.stringify({ claudeSessionId: sessionId });
  const req = http.request({
    hostname: 'localhost',
    port: API_PORT,
    path: `/api/panes/${paneId}`,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'x-spaces-internal': internalToken,
    },
    timeout: 5000,
  }, (res) => {
    res.resume(); // consume body
    if (res.statusCode < 300) {
      console.log(`[Session Persist] Saved session ${sessionId.slice(0, 8)} to DB for pane ${paneId.slice(0, 8)}`);
    } else {
      console.error(`[Session Persist] DB update failed: HTTP ${res.statusCode} for pane ${paneId.slice(0, 8)}`);
      if (retries < 3) setTimeout(() => persistSessionToDb(paneId, sessionId, retries + 1), 3000);
    }
  });
  req.on('error', (err) => {
    console.error(`[Session Persist] HTTP error for pane ${paneId.slice(0, 8)}: ${err.message}`);
    if (retries < 3) setTimeout(() => persistSessionToDb(paneId, sessionId, retries + 1), 3000);
  });
  req.on('timeout', () => { req.destroy(); });
  req.write(payload);
  req.end();
}

function detectNewClaudeSession(paneId, cwd, ws, session, username) {
  const claudeProjectsDir = path.join(getUserHome(username), '.claude', 'projects');

  // CRITICAL FIX: scope detection to the project directory matching this pane's CWD.
  // Previously, this scanned ALL project directories for any new .jsonl file.
  // When multiple panes started Claude simultaneously (e.g. workspace load),
  // panes could steal each other's session IDs — Pane A would detect Pane B's
  // new session file first and claim it, leaving Pane B with no session.
  const expectedProjectKey = cwdToProjectKey(cwd);
  const expectedProjPath = path.join(claudeProjectsDir, expectedProjectKey);

  const knownSessionIds = new Set();
  try {
    if (fs.existsSync(expectedProjPath)) {
      for (const item of fs.readdirSync(expectedProjPath)) {
        const m = item.match(UUID_JSONL_RE);
        if (m) knownSessionIds.add(m[1]);
      }
      const indexPath = path.join(expectedProjPath, 'sessions-index.json');
      if (fs.existsSync(indexPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
          if (data.entries) {
            for (const entry of data.entries) knownSessionIds.add(entry.sessionId);
          }
        } catch { /* ignore */ }
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
      // Project directory may not exist yet if Claude hasn't started writing
      if (!fs.existsSync(expectedProjPath)) return;

      for (const item of fs.readdirSync(expectedProjPath)) {
        const m = item.match(UUID_JSONL_RE);
        if (m && !knownSessionIds.has(m[1])) {
          const newSessionId = m[1];
          clearInterval(interval);
          console.log(`[Session Detect] Pane ${paneId.slice(0, 8)} (${username}): detected session ${newSessionId} in ${expectedProjectKey}`);

          // Cache in memory so reattaching WebSocket gets the session ID
          session.detectedSessionId = newSessionId;

          // Persist to DB server-side — this is the reliability backstop.
          // Even if the WebSocket message below never reaches the frontend,
          // the DB will have the correct sessionId for future loads.
          persistSessionToDb(paneId, newSessionId);

          // Also notify the frontend via WebSocket (for immediate UI update)
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

  // Get the remote WebSocket URL via the terminal token endpoint
  // Only skip TLS verification if explicitly opted in (e.g., self-signed certs)
  const skipTls = process.env.SPACES_SKIP_TLS_VERIFY === '1';
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (skipTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  let remoteWsUrl;
  try {
    const tokenUrl = `${node.url}/api/network/terminal/token/`;
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

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
  } finally {
    if (prevTls === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
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

function startMdnsIfNeeded(httpPort) {
  if (SPACES_TIER === 'federation') {
    try {
      const { startMdns } = require('./mdns-service');
      startMdns(httpPort || PORT);
    } catch (err) {
      console.log('[mDNS] Discovery not available:', err.message);
    }
  } else {
    console.log(`[mDNS] Skipped (tier=${SPACES_TIER}, requires federation)`);
  }
}

// ─── Poll-based idle nudge for agent collaboration ───────

function startMessageWatcher(apiPort) {
  try {
    const teams = require('@spaces/teams');
    teams.terminal.startMessageWatcher(apiPort, sessions);
  } catch { /* @spaces/teams not installed — no message watcher */ }
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

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
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
    // Non-/ws upgrades are left for other listeners (e.g. HMR proxy)
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
      for (const file of fs.readdirSync(chatsDir)) {
        if (file.startsWith('session-') && file.endsWith('.json')) {
          const id = path.basename(file, '.json');
          if (!knownIds.has(id)) {
            console.log(`[Session Detect] Gemini: detected new session file ${file}`);
            try {
              const sessionData = JSON.parse(fs.readFileSync(path.join(chatsDir, file), 'utf-8'));
              const realId = sessionData.sessionId;
              if (realId) {
                clearInterval(interval);
                console.log(`[Session Detect] Gemini: detected session UUID ${realId}`);
                session.detectedSessionId = realId;
                persistSessionToDb(paneId, realId);
                if (session.ws && session.ws.readyState === 1) {
                  session.ws.send(JSON.stringify({ type: 'session-detected', sessionId: realId, paneId }));
                }
                return;
              }
            } catch (err) {
              console.error(`[Session Detect] Gemini: failed to read session file ${file}:`, err.message);
            }
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
    const head = readFileHead(filePath, 4096);
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
            clearInterval(interval);
            console.log(`[Session Detect] Forge: detected session ${id}`);
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

module.exports = { createTerminalServer };

