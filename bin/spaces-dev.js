#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const SPACES_DIR = path.join(os.homedir(), '.spaces');
const CONFIG_PATH = path.join(SPACES_DIR, 'server.json');
const SESSION_SECRET_PATH = path.join(SPACES_DIR, 'session_secret');

// ─── Load saved config ────────────────────────────────────
let savedConfig = {};
if (fs.existsSync(CONFIG_PATH)) {
  try { savedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
}

// ─── Resolve settings (env > config > defaults) ──────────
const NEXT_INTERNAL_PORT = parseInt(process.env.SPACES_NEXT_PORT || '3400', 10);
const PORT = parseInt(process.env.SPACES_PORT || '', 10) || savedConfig.port || 3457;

const basePath = process.env.SPACES_BASE_PATH || savedConfig.basePath || '';
if (basePath) {
  process.env.SPACES_BASE_PATH = basePath;
}

// ─── Auto-detect tier ─────────────────────────────────────
let hasSpacesPro = false;
let hasSpacesTeams = false;
try { require.resolve('@spaces/pro'); hasSpacesPro = true; } catch {}
try { require.resolve('@spaces/teams'); hasSpacesTeams = true; } catch {}

let tier = process.env.SPACES_TIER || savedConfig.tier || '';
if (!tier) {
  if (hasSpacesPro) tier = 'federation';
  else if (hasSpacesTeams) tier = 'team';
  else tier = 'community';
}
process.env.SPACES_TIER = tier;

// Require terminal-server AFTER tier is set so it reads the correct SPACES_TIER
const { createTerminalServer } = require('./terminal-server');

// ─── Federation prerequisites — auto-setup if needed ──────
if (tier !== 'community') {
  let sessionSecret = process.env.SPACES_SESSION_SECRET || '';
  if (!sessionSecret && fs.existsSync(SESSION_SECRET_PATH)) {
    sessionSecret = fs.readFileSync(SESSION_SECRET_PATH, 'utf-8').trim();
  }

  const adminDbPath = path.join(SPACES_DIR, 'admin.db');
  if (!fs.existsSync(adminDbPath) || !sessionSecret) {
    const { autoSetup } = require('./lib/auto-setup');
    const result = autoSetup({ SPACES_DIR, SESSION_SECRET_PATH, ADMIN_DB_PATH: adminDbPath, CONFIG_PATH, tier, port: PORT, basePath });
    sessionSecret = result.sessionSecret;
  }

  process.env.SPACES_SESSION_SECRET = sessionSecret;
}

// Spawn Next.js dev server on an internal port
const childEnv = { ...process.env, PORT: String(NEXT_INTERNAL_PORT) };
const next = spawn('npx', ['next', 'dev', '--port', String(NEXT_INTERNAL_PORT)], {
  cwd: path.join(__dirname, '..'),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: childEnv,
  shell: true,
});

let nextReady = false;

next.stdout.on('data', (data) => {
  const msg = data.toString();
  process.stdout.write(msg);
  if (msg.includes('Ready') || msg.includes('started server') || msg.includes('Listening') || msg.includes('localhost')) {
    nextReady = true;
  }
});

next.stderr.on('data', (data) => {
  process.stderr.write(data);
});

next.on('exit', (code) => {
  console.error(`[spaces-dev] Next.js exited with code ${code}`);
  process.exit(code || 1);
});

// Create unified HTTP server
const server = http.createServer((req, res) => {
  const proxyReq = http.request(
    {
      hostname: '127.0.0.1',
      port: NEXT_INTERNAL_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on('error', (err) => {
    // Next.js not ready yet
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Next.js dev server not ready yet. Refresh in a moment.');
    }
  });
  req.pipe(proxyReq);
});

// Attach terminal WebSocket server for /ws upgrades
createTerminalServer(server);

// Proxy non-/ws upgrades (Next.js HMR WebSocket) to Next.js dev
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws' && !url.pathname.endsWith('/ws')) {
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: NEXT_INTERNAL_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    });
    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\n'
      );
      if (proxyHead.length > 0) proxySocket.unshift(proxyHead);
      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
      proxySocket.on('close', () => {
        console.log(`[HMR proxy] upstream closed (${url.pathname})`);
      });
      socket.on('close', () => {
        console.log(`[HMR proxy] browser closed (${url.pathname})`);
      });
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });
    proxyReq.on('response', (res) => {
      // Upgrade was rejected — log and clean up
      console.log(`[HMR proxy] upgrade rejected: ${res.statusCode} for ${url.pathname}`);
      socket.destroy();
    });
    proxyReq.on('error', (err) => {
      console.log(`[HMR proxy] error: ${err.message}`);
      socket.destroy();
    });
    socket.on('error', () => {});
    if (head.length > 0) proxyReq.write(head);
    proxyReq.end();
  }
});

server.listen(PORT, () => {
  console.log(`\n  Spaces dev server on http://localhost:${PORT}\n`);
});

// Cleanup
function cleanup() {
  next.kill();
  server.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
