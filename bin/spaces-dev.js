#!/usr/bin/env node

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { createTerminalServer } = require('./terminal-server');

const NEXT_INTERNAL_PORT = 3400;
const PORT = parseInt(process.env.SPACES_PORT || '3457', 10);

// Spawn Next.js dev server on an internal port
const next = spawn('npx', ['next', 'dev', '--port', String(NEXT_INTERNAL_PORT)], {
  cwd: path.join(__dirname, '..'),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(NEXT_INTERNAL_PORT) },
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
  if (url.pathname !== '/ws') {
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
      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });
    proxyReq.on('error', () => {
      socket.destroy();
    });
    socket.on('error', () => {});
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
