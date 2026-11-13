#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { pinSpacesHome } = require('./lib/spaces-home');
const SPACES_DIR = (() => {
  // Resolve once and pin SPACES_HOME to the absolute path, so children started
  // in another cwd (Next, panes) use the same folder. A bad value is one line.
  try { return pinSpacesHome(); } catch (e) { console.error(`  ${e.message}`); process.exit(1); }
})();
const CONFIG_PATH = path.join(SPACES_DIR, 'server.json');
const SESSION_SECRET_PATH = path.join(SPACES_DIR, 'session_secret');
const INTERNAL_TOKEN_PATH = path.join(SPACES_DIR, 'internal_token');

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

const allowedOrigins = process.env.SPACES_ALLOWED_ORIGINS || savedConfig.allowedOrigins || '';
if (allowedOrigins) {
  process.env.SPACES_ALLOWED_ORIGINS = allowedOrigins;
}

// ─── Managed packages directory ─────────────────────────────
const MANAGED_PACKAGES = path.join(SPACES_DIR, 'packages');
const MANAGED_NODE_MODULES = path.join(MANAGED_PACKAGES, 'node_modules');

// ─── Multiuser flag ──────────────────────────────────────────
const isMultiuser = process.env.SPACES_MULTIUSER === '1' || savedConfig.multiuser === true;
if (isMultiuser) process.env.SPACES_MULTIUSER = '1';

// Desktop = localhost only (single-user, no login). Multiuser = wildcard
// (LAN-reachable, every request authenticates).
const bindHost = isMultiuser ? '0.0.0.0' : '127.0.0.1';

// ─── NODE_PATH for the managed packages dir ──────────────────
const nodePaths = [MANAGED_NODE_MODULES];
for (const dir of nodePaths) {
  const existing = process.env.NODE_PATH || '';
  if (!existing.includes(dir)) {
    process.env.NODE_PATH = existing ? `${dir}${path.delimiter}${existing}` : dir;
  }
}
require('module').Module._initPaths();

// Require terminal-server AFTER env is set so it reads the correct SPACES_MULTIUSER
const { createTerminalServer } = require('./terminal-server');

// ─── Multiuser prerequisites — auto-setup if needed ──────────
if (isMultiuser) {
  let sessionSecret = process.env.SPACES_SESSION_SECRET || '';
  if (!sessionSecret && fs.existsSync(SESSION_SECRET_PATH)) {
    sessionSecret = fs.readFileSync(SESSION_SECRET_PATH, 'utf-8').trim();
  }

  const adminDbPath = path.join(SPACES_DIR, 'admin.db');
  if (!fs.existsSync(adminDbPath) || !sessionSecret) {
    const { autoSetup } = require('./lib/auto-setup');
    const result = autoSetup({ SPACES_DIR, SESSION_SECRET_PATH, INTERNAL_TOKEN_PATH, ADMIN_DB_PATH: adminDbPath, CONFIG_PATH, port: PORT, basePath });
    sessionSecret = result.sessionSecret;
  }

  process.env.SPACES_SESSION_SECRET = sessionSecret;
}

// Internal token: the owner's secret in desktop mode (lib/desktop-auth.js),
// and how local hooks/MCP authenticate. Always present.
{
  let internalToken = process.env.SPACES_INTERNAL_TOKEN || '';
  if (!internalToken && fs.existsSync(INTERNAL_TOKEN_PATH)) {
    internalToken = fs.readFileSync(INTERNAL_TOKEN_PATH, 'utf-8').trim();
  }
  if (!internalToken) {
    internalToken = crypto.randomBytes(32).toString('hex');
    if (!fs.existsSync(SPACES_DIR)) fs.mkdirSync(SPACES_DIR, { recursive: true });
    fs.writeFileSync(INTERNAL_TOKEN_PATH, internalToken, { mode: 0o600 });
  }
  process.env.SPACES_INTERNAL_TOKEN = internalToken;
}

// Spawn Next.js dev server on an internal port
const childEnv = { ...process.env, PORT: String(NEXT_INTERNAL_PORT) };
const next = spawn('npx', ['next', 'dev', '--hostname', bindHost, '--port', String(NEXT_INTERNAL_PORT)], {
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

// Desktop-mode authentication, as in bin/spaces.js: refuse rebound
// hostnames, and swap one-time sign-in links for the session cookie. The
// middleware does the rest.
const desktopAuth = require('./lib/desktop-auth');
const loginCodes = desktopAuth.createLoginCodes(() => process.env.SPACES_INTERNAL_TOKEN);
const allowedHostList = String(process.env.SPACES_ALLOWED_ORIGINS || savedConfig.allowedOrigins || '')
  .split(',').map((h) => h.trim()).filter(Boolean);

function desktopFrontDoor(req, res) {
  if (isMultiuser) return false;
  if (!desktopAuth.isLocalHost(req.headers.host, allowedHostList)) {
    res.writeHead(421, { 'Content-Type': 'text/plain' });
    res.end('Unrecognized host');
    return true;
  }
  if ((req.url || '').split('?')[0].replace(/\/$/, '') !== '/auth/desktop') return false;
  const code = new URL(req.url, 'http://localhost').searchParams.get('code') || '';
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (req.method !== 'GET' || !loginCodes.redeem(code)) {
    res.writeHead(401, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('This sign-in link has expired or was already used.');
    return true;
  }
  const session = desktopAuth.signDesktop(process.env.SPACES_INTERNAL_TOKEN, 'session', desktopAuth.SESSION_TTL_S);
  desktopAuth.signedInPage(res, desktopAuth.desktopCookie(session, ''), '/');
  return true;
}

// Create unified HTTP server
const server = http.createServer((req, res) => {
  if (desktopFrontDoor(req, res)) return;
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

// Both /ws (legacy terminal) and /proto + /proto/pane/<id> (runtime-core
// control channel + pane data sockets) are fully handled by
// createTerminalServer()'s own 'upgrade' listener above. Node invokes every
// 'upgrade' listener in registration order and does NOT stop at the first
// one that calls handleUpgrade() — this HMR listener must recognize and
// skip those paths too, or it steals the (already-handled) upgrade and
// proxies it to Next.js, destroying the socket createTerminalServer just
// completed the WebSocket handshake on. Matches the same route-matching
// style as terminal-server.js's own upgrade handler.
function isProtoPath(pathname) {
  return pathname === '/proto' || pathname.endsWith('/proto') || /\/proto\/pane\/[^/]+$/.test(pathname);
}

// Proxy non-/ws, non-/proto upgrades (Next.js HMR WebSocket) to Next.js dev
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws' && !url.pathname.endsWith('/ws') && !isProtoPath(url.pathname)) {
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

server.listen(PORT, bindHost, () => {
  console.log(`\n  Spaces dev server on http://localhost:${PORT}`);
  if (!isMultiuser) {
    // The developer's own terminal; the link works once, for two minutes.
    console.log(`  Sign in: http://localhost:${PORT}/auth/desktop?code=${loginCodes.mint()}`);
  }
  console.log('');
});

// ─── HTTPS server for WebXR (Quest requires secure context) ──
const HTTPS_PORT = parseInt(process.env.SPACES_HTTPS_PORT || '', 10) || PORT + 1;
const certsDir = path.join(__dirname, '..', 'certs');
if (fs.existsSync(path.join(certsDir, 'cert.crt')) && fs.existsSync(path.join(certsDir, 'cert.key'))) {
  const https = require('https');
  const httpsOptions = {
    key: fs.readFileSync(path.join(certsDir, 'cert.key')),
    cert: fs.readFileSync(path.join(certsDir, 'cert.crt')),
  };
  const httpsServer = https.createServer(httpsOptions, (req, res) => {
    const proxyReq = http.request(
      { hostname: '127.0.0.1', port: NEXT_INTERNAL_PORT, path: req.url, method: req.method, headers: req.headers },
      (proxyRes) => { res.writeHead(proxyRes.statusCode, proxyRes.headers); proxyRes.pipe(res); }
    );
    proxyReq.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('Not ready'); } });
    req.pipe(proxyReq);
  });
  createTerminalServer(httpsServer);
  httpsServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'https://localhost');
    if (url.pathname !== '/ws' && !url.pathname.endsWith('/ws') && !isProtoPath(url.pathname)) {
      const proxyReq = http.request({ hostname: '127.0.0.1', port: NEXT_INTERNAL_PORT, path: req.url, method: req.method, headers: req.headers });
      proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
        if (proxyHead.length > 0) proxySocket.unshift(proxyHead);
        proxySocket.pipe(socket); socket.pipe(proxySocket);
        proxySocket.on('error', () => socket.destroy()); socket.on('error', () => proxySocket.destroy());
      });
      proxyReq.on('error', () => socket.destroy());
      socket.on('error', () => {});
      if (head.length > 0) proxyReq.write(head);
      proxyReq.end();
    }
  });
  httpsServer.listen(HTTPS_PORT, bindHost, () => {
    const lanIp = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal)?.address || 'localhost';
    console.log(`  Spaces HTTPS (VR) on https://${lanIp}:${HTTPS_PORT}/vr\n`);
  });
}

// Cleanup
function cleanup() {
  next.kill();
  server.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
