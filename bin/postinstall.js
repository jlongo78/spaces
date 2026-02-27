#!/usr/bin/env node

// Postinstall script for @jlongo78/agent-spaces
//
// 1. Rebuilds better-sqlite3 native addon for the current Node.js version
// 2. Removes any pre-compiled native modules from the standalone bundle
//    so they resolve from the parent node_modules/ (where they were just rebuilt)

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Step 1: Rebuild native modules for this Node version
console.log('[postinstall] Rebuilding better-sqlite3 for Node', process.version, '...');
try {
  execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
} catch (e) {
  console.error('[postinstall] Warning: failed to rebuild better-sqlite3:', e.message);
}

// Step 2: Remove stale native binaries from standalone bundle
// Next.js standalone mode copies native modules built on the CI Node version.
// These will crash at runtime if the user's Node version differs.
const standaloneModules = path.join(__dirname, '..', '.next', 'standalone', 'node_modules');
const nativeModules = ['better-sqlite3', 'node-pty', 'bindings', 'file-uri-to-path', 'detect-libc'];

for (const mod of nativeModules) {
  const modDir = path.join(standaloneModules, mod);
  if (fs.existsSync(modDir)) {
    fs.rmSync(modDir, { recursive: true, force: true });
    console.log(`[postinstall] Removed stale native module from standalone: ${mod}`);
  }
}

console.log('[postinstall] Done.');
