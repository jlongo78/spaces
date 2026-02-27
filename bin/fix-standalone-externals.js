#!/usr/bin/env node

// Turbopack mangles serverExternalPackages names with a hash suffix
// (e.g. "better-sqlite3-90e2652d1716b047"). This script scans the
// standalone build output, finds all mangled require() calls, and
// creates proxy modules so the standalone server can resolve them.

const fs = require('fs');
const path = require('path');

const chunksDir = path.join(__dirname, '..', '.next', 'standalone', '.next', 'server', 'chunks');
const standaloneModules = path.join(__dirname, '..', '.next', 'standalone', 'node_modules');

if (!fs.existsSync(chunksDir)) {
  console.log('[fix-externals] No standalone chunks found, skipping.');
  process.exit(0);
}

// Scan all JS chunk files for mangled external requires
const re = /require\("([a-z@][a-z0-9@/_.-]*)-([0-9a-f]{16})"\)/g;
const aliases = new Map(); // mangled name -> real package name

const files = fs.readdirSync(chunksDir).filter(f => f.endsWith('.js'));
for (const file of files) {
  const content = fs.readFileSync(path.join(chunksDir, file), 'utf-8');
  let match;
  while ((match = re.exec(content)) !== null) {
    const mangledName = `${match[1]}-${match[2]}`;
    const realName = match[1];
    aliases.set(mangledName, realName);
  }
}

if (aliases.size === 0) {
  console.log('[fix-externals] No mangled externals found.');
  process.exit(0);
}

for (const [alias, real] of aliases) {
  const aliasDir = path.join(standaloneModules, alias);
  if (fs.existsSync(aliasDir)) continue;

  fs.mkdirSync(aliasDir, { recursive: true });
  fs.writeFileSync(
    path.join(aliasDir, 'index.js'),
    `module.exports = require(${JSON.stringify(real)});\n`
  );
  fs.writeFileSync(
    path.join(aliasDir, 'package.json'),
    JSON.stringify({ name: alias, version: '1.0.0', main: 'index.js' }) + '\n'
  );
  console.log(`[fix-externals] Created alias: ${alias} -> ${real}`);
}

// Remove native modules from the standalone bundle.
// Next.js standalone mode copies all traced dependencies into
// .next/standalone/node_modules/, including pre-compiled native addons.
// These binaries are built for the CI Node version and will fail on
// machines running a different Node version (NODE_MODULE_VERSION mismatch).
// Removing them forces resolution to the parent node_modules/ where
// the postinstall `npm rebuild` compiles them for the user's Node version.
const nativeModules = ['better-sqlite3', 'node-pty'];
for (const mod of nativeModules) {
  const modDir = path.join(standaloneModules, mod);
  if (fs.existsSync(modDir)) {
    fs.rmSync(modDir, { recursive: true, force: true });
    console.log(`[fix-externals] Removed native module from standalone: ${mod}`);
  }
}

// Also remove transitive native dependencies that Next.js may have copied
const nativeTransitive = ['bindings', 'file-uri-to-path', 'detect-libc'];
for (const mod of nativeTransitive) {
  const modDir = path.join(standaloneModules, mod);
  if (fs.existsSync(modDir)) {
    fs.rmSync(modDir, { recursive: true, force: true });
    console.log(`[fix-externals] Removed transitive native dep from standalone: ${mod}`);
  }
}
