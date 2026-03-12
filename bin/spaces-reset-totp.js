#!/usr/bin/env node

const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const SPACES_DIR = path.join(os.homedir(), '.spaces');
const ADMIN_DB_PATH = path.join(SPACES_DIR, 'admin.db');

const args = process.argv.slice(2);
const username = args[0];

if (!username || username === '--help' || username === '-h') {
  console.log(`
  Spaces — Reset TOTP

  Usage:
    spaces reset-totp <username>

  Clears the TOTP secret for a user so they can set up
  a new authenticator on their next login.
`);
  process.exit(username ? 0 : 1);
}

if (!require('fs').existsSync(ADMIN_DB_PATH)) {
  console.error(`  Error: Admin database not found at ${ADMIN_DB_PATH}`);
  console.error('  Run "spaces --setup" first.');
  process.exit(1);
}

const db = new Database(ADMIN_DB_PATH);
const user = db.prepare('SELECT id, username, totp_enabled FROM users WHERE username = ?').get(username);

if (!user) {
  console.error(`  Error: No user found with username "${username}"`);
  db.close();
  process.exit(1);
}

if (!user.totp_enabled) {
  console.log(`  User "${username}" does not have TOTP enabled. Nothing to reset.`);
  db.close();
  process.exit(0);
}

db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(user.id);
db.close();

console.log(`  TOTP reset for "${username}". They will set up a new authenticator on next login.`);
