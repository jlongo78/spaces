#!/usr/bin/env node

const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.SPACES_WS_PORT || '3458', 10);
const SPACES_TIER = process.env.SPACES_TIER || 'community';

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
  custom: { command: '',       resumeFlag: '',         resumeStyle: '' },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

// ─── Origin validation ───────────────────────────────────
function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    // Allow localhost/127.0.0.1 (any port)
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
    // Allow configured hostname from env (e.g., spaces.example.com)
    const allowed = process.env.SPACES_ALLOWED_ORIGINS;
    if (allowed) {
      return allowed.split(',').some(h => url.hostname === h.trim());
    }
    // In server/federation mode, require explicit allowed origins
    if (SPACES_TIER === 'server' || SPACES_TIER === 'federation') return false;
    // Desktop/community: allow any origin
    return true;
  } catch {
    return false;
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
  const agentSession = (rawAgentSession === 'new' || UUID_RE.test(rawAgentSession)) ? rawAgentSession : '';
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
    existing.ws = ws;

    // Replay buffered output so user sees context
    for (const chunk of existing.buffer) {
      ws.send(JSON.stringify({ type: 'data', data: chunk }));
    }

    try { existing.pty.resize(cols, rows); } catch { /* ignore */ }

    ws.send(JSON.stringify({ type: 'ready', paneId, reattached: true }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'data') {
          existing.pty.write(msg.data);
        } else if (msg.type === 'resize') {
          try { existing.pty.resize(msg.cols, msg.rows); } catch { /* ignore */ }
        }
      } catch {
        existing.pty.write(raw.toString());
      }
    });

    ws.on('close', () => {
      if (existing.ws === ws) existing.ws = null;
    });

    return;
  }

  // Create new pty session
  const isWindows = process.platform === 'win32';

  // Resolve the OS shell user for this app user
  const shellUser = lookupShellUser(username);
  const processUser = os.userInfo().username;
  let shell, args;
  const isSSH = !isWindows && shellUser !== processUser;
  if (isSSH) {
    // SSH to localhost as the mapped shell user using the service key
    shell = '/usr/bin/ssh';
    args = [
      '-4',
      '-i', SERVICE_KEY,
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${path.join(os.homedir(), '.spaces', 'known_hosts')}`,
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

  const env = { ...process.env };
  delete env.CLAUDECODE;
  // Tell Claude Code where git-bash is so it doesn't fail the bash detection
  if (isWindows && shell && shell.endsWith('bash.exe') && !env.CLAUDE_CODE_GIT_BASH_PATH) {
    env.CLAUDE_CODE_GIT_BASH_PATH = shell;
  }

  // Fall back to HOME if cwd doesn't exist (e.g. remote path from another node)
  let safeCwd = cwd;
  if (!fs.existsSync(safeCwd)) {
    safeCwd = process.env.HOME || '/root';
    console.log(`[Spawn] cwd "${cwd}" does not exist, falling back to "${safeCwd}"`);
  }

  console.log(`[Spawn] user=${username} shell=${shell} args=${JSON.stringify(args)} cwd=${safeCwd} agentType=${agentType}`);

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

  const session = { pty: term, ws, buffer: [], exited: false, username };
  sessions.set(paneId, session);
  analyticsRecordSessionStart(paneId, username, agentType);

  // ─── Inject cd for SSH sessions, then agent command ─────
  const agent = AGENTS[agentType] || AGENTS.shell;

  // SSH sessions start in the remote user's home dir — cd to target cwd first
  if (isSSH) {
    // Use single quotes to prevent shell expansion; escape any single quotes in the path
    const escapedCwd = safeCwd.replace(/'/g, "'\\''");
    setTimeout(() => {
      if (!session.exited) {
        term.write(`cd '${escapedCwd}'\r`);
      }
    }, 300);
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
          setTimeout(() => {
            if (session.exited) return;
            if (sessionCwd && sessionCwd !== safeCwd) {
              const cdCmd = isWindows ? `cd /d "${sessionCwd}"` : `cd "${sessionCwd}"`;
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
      }
    } catch {
      term.write(raw.toString());
    }
  });

  ws.on('close', () => {
    if (session.ws === ws) session.ws = null;
  });

  ws.send(JSON.stringify({ type: 'ready', paneId }));

  // ─── Session ID detection for new Claude sessions ────────
  if (agentType === 'claude' && (!agentSession || agentSession === 'new')) {
    detectNewClaudeSession(paneId, cwd, ws, session, username);
  }
}

// ─── Claude-specific helpers ──────────────────────────────

function getUserHome(username) {
  const shellUser = lookupShellUser(username);
  if (shellUser === os.userInfo().username) return os.homedir();
  return `/home/${shellUser}`;
}

const UUID_JSONL_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

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

        // Fallback: derive CWD from the project directory name
        // Claude encodes paths as e.g. "-home-user-projects-myapp"
        const derivedPath = '/' + projDir.name.replace(/^-/, '').replace(/-/g, '/');
        if (fs.existsSync(derivedPath)) {
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

function detectNewClaudeSession(paneId, cwd, ws, session, username) {
  const claudeProjectsDir = path.join(getUserHome(username), '.claude', 'projects');

  const knownSessionIds = new Set();
  try {
    if (!fs.existsSync(claudeProjectsDir)) { /* will be created */ }
    else {
      for (const projDir of fs.readdirSync(claudeProjectsDir, { withFileTypes: true })) {
        if (!projDir.isDirectory()) continue;
        const projPath = path.join(claudeProjectsDir, projDir.name);
        try {
          for (const item of fs.readdirSync(projPath)) {
            const m = item.match(UUID_JSONL_RE);
            if (m) knownSessionIds.add(m[1]);
          }
          const indexPath = path.join(projPath, 'sessions-index.json');
          if (fs.existsSync(indexPath)) {
            try {
              const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
              if (data.entries) {
                for (const entry of data.entries) knownSessionIds.add(entry.sessionId);
              }
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  console.log(`[Session Detect] Pane ${paneId.slice(0, 8)} (${username}): snapshot ${knownSessionIds.size} existing sessions`);

  let attempts = 0;
  const maxAttempts = 45;
  const interval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts || session.exited) {
      clearInterval(interval);
      return;
    }

    try {
      if (!fs.existsSync(claudeProjectsDir)) return;

      for (const projDir of fs.readdirSync(claudeProjectsDir, { withFileTypes: true })) {
        if (!projDir.isDirectory()) continue;
        const projPath = path.join(claudeProjectsDir, projDir.name);
        try {
          for (const item of fs.readdirSync(projPath)) {
            const m = item.match(UUID_JSONL_RE);
            if (m && !knownSessionIds.has(m[1])) {
              const newSessionId = m[1];
              clearInterval(interval);
              console.log(`[Session Detect] Pane ${paneId.slice(0, 8)} (${username}): detected session ${newSessionId}`);
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

function startMdnsIfNeeded() {
  if (SPACES_TIER === 'federation') {
    try {
      const { startMdns } = require('./mdns-service');
      startMdns(PORT);
    } catch (err) {
      console.log('[mDNS] Discovery not available:', err.message);
    }
  } else {
    console.log(`[mDNS] Skipped (tier=${SPACES_TIER}, requires federation)`);
  }
}

// ─── Attached mode: mount on an existing HTTP server ─────

function createTerminalServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });
  setupWss(wss);

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/ws') {
      // Verify origin for browser clients
      const origin = req.headers.origin;
      if (origin && !isAllowedOrigin(origin)) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
    // Non-/ws upgrades are left for other listeners (e.g. HMR proxy)
  });

  startMdnsIfNeeded();
  return wss;
}

// ─── Standalone mode (run directly) ──────────────────────

if (require.main === module) {
  const wss = new WebSocketServer({
    port: PORT,
    verifyClient: ({ req }) => {
      const origin = req.headers.origin;
      if (!origin) return true;
      return isAllowedOrigin(origin);
    },
  });
  setupWss(wss);
  startMdnsIfNeeded();
  console.log(`Terminal WebSocket server running on ws://localhost:${PORT}`);
}

module.exports = { createTerminalServer };
