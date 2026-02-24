#!/usr/bin/env node

// Turbopack mangles external module names with a hash suffix.
// When installed via npm, the standalone server can't resolve these.
// This script creates aliases so the mangled names resolve correctly.

const fs = require('fs');
const path = require('path');

const standaloneModules = path.join(__dirname, '..', '.next', 'standalone', 'node_modules');

// Only run if this is a standalone (npm) install
if (!fs.existsSync(standaloneModules)) process.exit(0);

// Map of mangled name -> real package name
const aliases = {
  'better-sqlite3-90e2652d1716b047': 'better-sqlite3',
};

for (const [alias, real] of Object.entries(aliases)) {
  const aliasPath = path.join(standaloneModules, alias);
  const realPath = path.join(standaloneModules, real);

  if (fs.existsSync(realPath) && !fs.existsSync(aliasPath)) {
    try {
      // Try symlink first, fall back to writing a proxy module
      fs.symlinkSync(realPath, aliasPath, 'junction');
    } catch {
      // Symlinks may fail without admin rights — write a proxy instead
      fs.mkdirSync(aliasPath, { recursive: true });
      fs.writeFileSync(
        path.join(aliasPath, 'index.js'),
        `module.exports = require(${JSON.stringify(real)});\n`
      );
      fs.writeFileSync(
        path.join(aliasPath, 'package.json'),
        JSON.stringify({ name: alias, version: '1.0.0', main: 'index.js' }) + '\n'
      );
    }
  }
}
