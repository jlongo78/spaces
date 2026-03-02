// Non-interactive first-time setup for Spaces federation edition.
// Called automatically when @spaces/pro is detected but admin.db or session_secret are missing.
// For interactive customization, use: spaces --setup

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  const bytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) {
    password += chars[bytes[i] % chars.length];
  }
  return password;
}

function autoSetup({ SPACES_DIR, SESSION_SECRET_PATH, ADMIN_DB_PATH, CONFIG_PATH, tier, port, basePath }) {
  // Ensure ~/.spaces directory
  if (!fs.existsSync(SPACES_DIR)) {
    fs.mkdirSync(SPACES_DIR, { recursive: true });
  }

  // Generate session secret
  let sessionSecret;
  if (fs.existsSync(SESSION_SECRET_PATH)) {
    sessionSecret = fs.readFileSync(SESSION_SECRET_PATH, 'utf-8').trim();
  }
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SESSION_SECRET_PATH, sessionSecret, { mode: 0o600 });
  }

  // Create admin DB and user
  let generatedPassword = null;
  if (!fs.existsSync(ADMIN_DB_PATH)) {
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

    generatedPassword = generatePassword();
    const shellUser = os.userInfo().username;
    const id = crypto.randomUUID();
    const passwordHash = hashPassword(generatedPassword);

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, shell_user, role)
      VALUES (?, ?, ?, ?, ?, 'admin')
    `).run(id, 'admin', passwordHash, 'Admin', shellUser);

    db.close();
  }

  // Save server.json if it doesn't exist
  if (!fs.existsSync(CONFIG_PATH)) {
    const config = { tier, port: port || 3457, basePath: basePath || '' };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  // Print credentials box
  if (generatedPassword) {
    console.log('');
    console.log('  ┌──────────────────────────────────────────┐');
    console.log('  │  First-time setup complete                │');
    console.log('  │                                           │');
    console.log('  │  Username:  admin                         │');
    console.log(`  │  Password:  ${generatedPassword}                │`);
    console.log('  │                                           │');
    console.log('  │  Run `spaces --setup` to customize.       │');
    console.log('  └──────────────────────────────────────────┘');
    console.log('');
  }

  return { sessionSecret, generatedPassword };
}

module.exports = { autoSetup, hashPassword, generatePassword };
