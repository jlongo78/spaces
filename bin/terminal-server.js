#!/usr/bin/env node

const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.SPACES_WS_PORT || '3458', 10);

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

// ─── SSH service key path ─────────────────────────────────

const SERVICE_KEY = path.join(os.homedir(), '.spaces', 'service_key');

// Session store: keeps ptys alive across WebSocket reconnections
// Key: paneId, Value: { pty, ws (current WebSocket or null), buffer (rolling output), username }
const sessions = new Map();

const MAX_BUFFER_LINES = 500;

// ─── Agent definitions (mirrors src/lib/agents.ts) ────────
const AGENTS = {
  shell:  { command: '',       resumeFlag: '' },
  claude: { command: 'claude', resumeFlag: '--resume' },
  codex:  { command: 'codex',  resumeFlag: '' },
  gemini: { command: 'gemini', resumeFlag: '' },
  aider:  { command: 'aider',  resumeFlag: '' },
  custom: { command: '',       resumeFlag: '' },
};

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const paneId = url.searchParams.get('paneId') || require('crypto').randomUUID();
  const cwd = url.searchParams.get('cwd') || process.env.HOME || process.env.USERPROFILE || 'C:\\';
  const agentType = url.searchParams.get('agentType') || 'shell';
  const agentSession = url.searchParams.get('agentSession') || '';
  const customCommand = url.searchParams.get('customCommand') || '';
  const cols = parseInt(url.searchParams.get('cols') || '120', 10);
  const rows = parseInt(url.searchParams.get('rows') || '30', 10);

  // Read authenticated user from SSO header (forwarded by nginx)
  const username = req.headers['x-auth-user'] || os.userInfo().username;

  // Verify terminal token (2FA)
  const terminalToken = url.searchParams.get('terminalToken') || '';
  const tokenUser = verifyTerminalToken(terminalToken);
  if (!tokenUser || tokenUser !== username) {
    ws.send(JSON.stringify({ type: 'error', data: '2FA verification required' }));
    ws.close();
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

  // If the authenticated user differs from the process user, spawn via SSH with service key
  const processUser = os.userInfo().username;
  let shell, args;
  if (!isWindows && username !== processUser) {
    shell = 'ssh';
    args = ['-i', SERVICE_KEY, '-tt', '-o', 'StrictHostKeyChecking=no', `${username}@localhost`];
  } else {
    shell = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
    args = [];
  }

  const env = { ...process.env };
  delete env.CLAUDECODE;

  console.log(`[Spawn] user=${username} shell=${shell} args=${JSON.stringify(args)} cwd=${cwd} agentType=${agentType}`);

  let term;
  try {
    term = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });
  } catch (err) {
    console.error(`[Spawn Error] ${err.message} (cwd=${cwd}, shell=${shell})`);
    ws.send(JSON.stringify({ type: 'error', data: `Failed to spawn: ${err.message}` }));
    ws.close();
    return;
  }

  const session = { pty: term, ws, buffer: [], exited: false, username };
  sessions.set(paneId, session);

  // ─── Inject agent command into the shell ────────────────
  const agent = AGENTS[agentType] || AGENTS.shell;

  if (agentType !== 'shell') {
    const command = agentType === 'custom' ? customCommand : agent.command;

    if (command) {
      if (agentSession && agentSession !== 'new') {
        // Resume an existing session
        if (agentType === 'claude') {
          // Claude needs to be run from the correct project CWD
          const sessionCwd = findSessionCwd(agentSession, username);
          setTimeout(() => {
            if (session.exited) return;
            if (sessionCwd && sessionCwd !== cwd) {
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
          }, 500);
        } else if (agent.resumeFlag) {
          setTimeout(() => {
            if (!session.exited) {
              term.write(`${command} ${agent.resumeFlag} ${agentSession}\r`);
            }
          }, 500);
        } else {
          // Agent doesn't support resume, just start it fresh
          setTimeout(() => {
            if (!session.exited) {
              term.write(`${command}\r`);
            }
          }, 500);
        }
      } else {
        // Start new session
        setTimeout(() => {
          if (!session.exited) {
            term.write(`${command}\r`);
          }
        }, 500);
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
    if (session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify({ type: 'exit', exitCode }));
    }
    setTimeout(() => {
      if (sessions.get(paneId) === session) {
        sessions.delete(paneId);
      }
    }, 30000);
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
});

// ─── Claude-specific helpers ──────────────────────────────

function getUserHome(username) {
  return `/home/${username}`;
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

wss.on('error', (err) => {
  console.error('[Terminal Server] Error:', err.message);
});

console.log(`Terminal WebSocket server running on ws://localhost:${PORT}`);
