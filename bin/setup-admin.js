#!/usr/bin/env node

const Database = require('better-sqlite3');
const crypto = require('crypto');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SPACES_DIR = path.join(os.homedir(), '.spaces');
const ADMIN_DB_PATH = path.join(SPACES_DIR, 'admin.db');
const SESSION_SECRET_PATH = path.join(SPACES_DIR, 'session_secret');

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptHidden(rl, question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(question);
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
        // Ctrl+C
        process.exit(1);
      } else if (ch === '\u007F' || ch === '\b') {
        // Backspace
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
  console.log('\n  Spaces — Admin Setup\n');

  // Ensure ~/.spaces directory exists
  if (!fs.existsSync(SPACES_DIR)) {
    fs.mkdirSync(SPACES_DIR, { recursive: true });
    console.log(`  Created ${SPACES_DIR}`);
  }

  // Generate session secret if missing
  let sessionSecretHex;
  if (fs.existsSync(SESSION_SECRET_PATH)) {
    sessionSecretHex = fs.readFileSync(SESSION_SECRET_PATH, 'utf-8').trim();
    console.log(`  Session secret already exists at ${SESSION_SECRET_PATH}`);
  } else {
    const secret = crypto.randomBytes(32);
    sessionSecretHex = secret.toString('hex');
    fs.writeFileSync(SESSION_SECRET_PATH, sessionSecretHex, { mode: 0o600 });
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

  console.log(`  Admin database at ${ADMIN_DB_PATH}\n`);

  // Check if admin already exists
  const existingAdmin = db.prepare("SELECT username FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existingAdmin) {
    console.log(`  An admin user already exists: ${existingAdmin.username}`);
    console.log(`  To create another admin, use the admin panel in the web UI.\n`);
    db.close();

    console.log('  ─────────────────────────────────────────');
    console.log(`  SPACES_SESSION_SECRET=${sessionSecretHex}`);
    console.log('  ─────────────────────────────────────────');
    console.log('\n  Set this as an environment variable before starting the server.\n');
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const username = (await prompt(rl, '  Username: ')).trim();
    if (!username) {
      console.error('  Error: username cannot be empty');
      process.exit(1);
    }

    // Check uniqueness
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      console.error(`  Error: user "${username}" already exists`);
      process.exit(1);
    }

    rl.close();

    const password = await promptHidden(null, '  Password: ');
    if (password.length < 8) {
      console.error('  Error: password must be at least 8 characters');
      process.exit(1);
    }

    const confirm = await promptHidden(null, '  Confirm password: ');
    if (password !== confirm) {
      console.error('  Error: passwords do not match');
      process.exit(1);
    }

    const rl2 = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const displayName = (await prompt(rl2, `  Display name [${username}]: `)).trim() || username;
    const shellUser = os.userInfo().username;

    rl2.close();

    // Create admin user
    const id = crypto.randomUUID();
    const passwordHash = hashPassword(password);

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, shell_user, role)
      VALUES (?, ?, ?, ?, ?, 'admin')
    `).run(id, username, passwordHash, displayName, shellUser);

    console.log(`\n  Admin user "${username}" created successfully.`);
    console.log(`  Shell user: ${shellUser}`);

  } catch (err) {
    console.error(`\n  Error: ${err.message}`);
    process.exit(1);
  } finally {
    db.close();
  }

  console.log('\n  ─────────────────────────────────────────');
  console.log(`  SPACES_SESSION_SECRET=${sessionSecretHex}`);
  console.log('  ─────────────────────────────────────────');
  console.log('\n  Set this as an environment variable before starting the server.');
  console.log('  Example: export SPACES_SESSION_SECRET=' + sessionSecretHex);
  console.log('  Or add it to your docker-compose.yml environment section.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
