#!/usr/bin/env node

const http = require('http');
const { execSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createTerminalServer } = require('./terminal-server');

const NEXT_INTERNAL_PORT = 3400;
const PORT = parseInt(process.env.SPACES_PORT || '3457', 10);
const projectDir = path.join(__dirname, '..');

console.log('');
console.log('  Spaces - Agent Workspace Manager');
console.log('  =================================');
console.log('');

// Verify build exists
const buildDir = path.join(projectDir, '.next');
if (!fs.existsSync(buildDir)) {
  console.error('  Error: No build found.');
  console.error('  Run "npm run build" first, or install via "npm install -g agent-spaces".');
  process.exit(1);
}

// Check for ~/.claude/ directory
const claudeDir = path.join(os.homedir(), '.claude');
if (!fs.existsSync(claudeDir)) {
  console.log('  Warning: ~/.claude/ not found. Have you used Claude Code yet?');
  console.log('');
}

// Spawn Next.js production server on an internal port
const next = spawn('npx', ['next', 'start', '--port', String(NEXT_INTERNAL_PORT)], {
  cwd: projectDir,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PORT: String(NEXT_INTERNAL_PORT),
    HOSTNAME: '0.0.0.0',
    NODE_ENV: 'production',
  },
  shell: true,
});

let nextReady = false;

next.stdout.on('data', (data) => {
  const msg = data.toString();
  process.stdout.write(msg);
  if (!nextReady && (msg.includes('Ready') || msg.includes('started server') || msg.includes('Listening') || msg.includes('localhost'))) {
    nextReady = true;
    console.log(`\n  Ready at http://localhost:${PORT}\n`);

    // Try to open browser (hardcoded localhost URL, no user input)
    const url = `http://localhost:${PORT}`;
    try {
      if (process.platform === 'win32') {
        execSync(`start ${url}`, { stdio: 'ignore' });
      } else if (process.platform === 'darwin') {
        execSync(`open ${url}`, { stdio: 'ignore' });
      } else {
        execSync(`xdg-open ${url}`, { stdio: 'ignore' });
      }
    } catch {
      console.log(`  Open ${url} in your browser`);
    }
  }
});

next.stderr.on('data', (data) => {
  const msg = data.toString();
  if (!msg.includes('Warning')) {
    process.stderr.write(data);
  }
});

next.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`  [spaces] Next.js exited with code ${code}`);
  }
  cleanup();
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
  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Server not ready yet. Refresh in a moment.');
    }
  });
  req.pipe(proxyReq);
});

// Attach terminal WebSocket server for /ws upgrades
createTerminalServer(server);

server.listen(PORT, () => {
  console.log(`  Starting server on http://localhost:${PORT}`);
  console.log('');
});

// Cleanup
function cleanup() {
  next.kill();
  server.close();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
