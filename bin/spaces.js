#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = process.env.SPACES_PORT || 3457;
const WS_PORT = process.env.SPACES_WS_PORT || 3458;
const projectDir = path.join(__dirname, '..');

console.log('');
console.log('  Spaces - Agent Workspace Manager');
console.log('  =================================');
console.log('');

// Check for ~/.claude/ directory
const claudeDir = path.join(os.homedir(), '.claude');
if (!fs.existsSync(claudeDir)) {
  console.log('  Warning: ~/.claude/ not found. Have you used Claude Code yet?');
  console.log('');
}

console.log(`  Starting web server on http://localhost:${PORT}`);
console.log(`  Starting terminal server on ws://localhost:${WS_PORT}`);
console.log('');

// Start the terminal WebSocket server
const termServer = spawn('node', [
  path.join(__dirname, 'terminal-server.js'),
], {
  cwd: projectDir,
  env: { ...process.env, SPACES_WS_PORT: String(WS_PORT) },
  stdio: 'pipe',
});

termServer.stdout.on('data', (data) => {
  console.log('  [terminal]', data.toString().trim());
});

termServer.stderr.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg) console.error('  [terminal]', msg);
});

// Start the Next.js server
const server = spawn('npx', ['next', 'start', '--port', String(PORT)], {
  cwd: projectDir,
  stdio: 'pipe',
  shell: true,
});

server.stdout.on('data', (data) => {
  const msg = data.toString();
  if (msg.includes('Ready')) {
    console.log(`  Ready at http://localhost:${PORT}`);
    console.log('');

    // Try to open browser
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

server.stderr.on('data', (data) => {
  const msg = data.toString();
  if (!msg.includes('Warning')) {
    process.stderr.write(data);
  }
});

function cleanup() {
  termServer.kill();
  server.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
