#!/usr/bin/env node

// Setup wizard for Spaces server edition.
// Run via: spaces --setup

const Database = require('better-sqlite3');
const crypto = require('crypto');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SPACES_DIR = path.join(os.homedir(), '.spaces');
const CONFIG_PATH = path.join(SPACES_DIR, 'server.json');
const ADMIN_DB_PATH = path.join(SPACES_DIR, 'admin.db');
const SESSION_SECRET_PATH = path.join(SPACES_DIR, 'session_secret');

function prompt(rl, question, defaultValue) {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => rl.question(`  ${question}${suffix}: `, (answer) => {
    resolve(answer.trim() || defaultValue || '');
  }));
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(`  ${question}: `);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(password);
      } else if (ch === '\u0003') {
        process.exit(1);
      } else if (ch === '\u007F' || ch === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        password += ch;
        stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  console.log('');
  console.log('  Spaces — Server Setup');
  console.log('  =====================');
  console.log('');

  // Ensure ~/.spaces directory
  if (!fs.existsSync(SPACES_DIR)) {
    fs.mkdirSync(SPACES_DIR, { recursive: true });
  }

  // Detect @spaces/pro (check managed install path first)
  let hasSpacesPro = false;
  const managedPro = path.join(SPACES_DIR, "packages", "node_modules", "@spaces", "pro", "dist", "index.js");
  if (fs.existsSync(managedPro)) {
    hasSpacesPro = true;
  } else {
    try { require.resolve("@spaces/pro"); hasSpacesPro = true; } catch {}
  }

  if (hasSpacesPro) {
    console.log('  Detected @spaces/pro — full features available.');
  } else {
    console.log('  @spaces/pro not found — community features only.');
    console.log('  Install @spaces/pro for auth, multi-user, and federation.');
  }
  console.log('');

  // Load existing config
  let existingConfig = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Tier
  const defaultTier = existingConfig.tier || (hasSpacesPro ? 'federation' : 'community');
  const tier = await prompt(rl, 'Tier (community|server|team|federation)', defaultTier);
  const validTiers = ['community', 'server', 'team', 'federation'];
  if (!validTiers.includes(tier)) {
    console.error(`\n  Error: Invalid tier "${tier}". Must be one of: ${validTiers.join(', ')}`);
    process.exit(1);
  }

  const needsAuth = tier !== 'community';

  // Admin user (non-community tiers)
  if (needsAuth) {
    console.log('');
    console.log('  Admin User');
    console.log('  ──────────');

    // Generate session secret if missing
    if (!fs.existsSync(SESSION_SECRET_PATH)) {
      const hex = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(SESSION_SECRET_PATH, hex, { mode: 0o600 });
      console.log(`  Generated session secret at ${SESSION_SECRET_PATH}`);
    }

    // Open/create admin database
    const db = new Database(ADMIN_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        shell_user TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        totp_secret TEXT,
        totp_enabled INTEGER DEFAULT 0,
        created TEXT DEFAULT (datetime('now'))
      );
    `);

    const existingAdmin = db.prepare("SELECT username FROM users WHERE role = 'admin' LIMIT 1").get();
    if (existingAdmin) {
      console.log(`  Admin user already exists: ${existingAdmin.username}`);
    } else {
      const username = await prompt(rl, 'Username', 'admin');
      if (!username) {
        console.error('  Error: username cannot be empty');
        process.exit(1);
      }

      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        console.error(`  Error: user "${username}" already exists`);
        process.exit(1);
      }

      rl.close();

      const password = await promptHidden('Password');
      if (password.length < 8) {
        console.error('  Error: password must be at least 8 characters');
        process.exit(1);
      }

      const confirm = await promptHidden('Confirm password');
      if (password !== confirm) {
        console.error('  Error: passwords do not match');
        process.exit(1);
      }

      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      const displayName = await prompt(rl2, 'Display name', username);
      rl2.close();

      let shellUser = os.userInfo().username;
      if (process.platform === 'win32' && shellUser.toUpperCase() === 'SYSTEM' && process.env.USERPROFILE) {
        shellUser = path.basename(process.env.USERPROFILE);
      }
      const id = crypto.randomUUID();
      const passwordHash = hashPassword(password);

      db.prepare(`
        INSERT INTO users (id, username, password_hash, display_name, shell_user, role)
        VALUES (?, ?, ?, ?, ?, 'admin')
      `).run(id, username, passwordHash, displayName, shellUser);

      console.log(`\n  Admin user "${username}" created.`);
    }
    db.close();
  }

  // Server config
  console.log('');
  console.log('  Server');
  console.log('  ──────────');

  // Close rl if it's still open (community path or existing admin path)
  try { rl.close(); } catch {}
  const rl3 = readline.createInterface({ input: process.stdin, output: process.stdout });

  const defaultPort = existingConfig.port || 3457;
  const portStr = await prompt(rl3, 'Port', String(defaultPort));
  const port = parseInt(portStr, 10) || defaultPort;

  const defaultBasePath = existingConfig.basePath || '';
  const basePath = await prompt(rl3, 'Base path (leave empty for root)', defaultBasePath);

  rl3.close();

  // Save config
  const config = { tier, port, basePath };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log('');
  console.log(`  Saved to ${CONFIG_PATH}`);

  // Generate proxy config hints if basePath is set
  if (basePath) {
    console.log('');
    console.log('  Reverse Proxy Configuration');
    console.log('  ───────────────────────────');
    console.log('');
    console.log('  For nginx:');
    console.log(`    location ${basePath}/ {`);
    console.log(`        proxy_pass http://localhost:${port}/;`);
    console.log('        proxy_http_version 1.1;');
    console.log('        proxy_set_header Upgrade $http_upgrade;');
    console.log('        proxy_set_header Connection "upgrade";');
    console.log('        proxy_set_header Host $host;');
    console.log('        proxy_set_header X-Real-IP $remote_addr;');
    console.log('    }');
    console.log('');
    console.log('  For Traefik (docker-compose labels):');
    console.log(`    - "traefik.http.routers.spaces.rule=PathPrefix(\`${basePath}\`)"`);
    console.log(`    - "traefik.http.middlewares.spaces-strip.stripprefix.prefixes=${basePath}"`);
    console.log('    - "traefik.http.routers.spaces.middlewares=spaces-strip"');
  }

  console.log('');
  console.log('  Start with: spaces');
  console.log('');
}

main().catch((err) => {
  console.error(`\n  Error: ${err.message}`);
  process.exit(1);
});
