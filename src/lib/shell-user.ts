import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { spacesHome } from '@/lib/spaces-home';

const ADMIN_DB_PATH = path.join(spacesHome(), 'admin.db');
const SERVICE_KEY = path.join(spacesHome(), 'service_key');
const KNOWN_HOSTS = path.join(spacesHome(), 'known_hosts');

type AdminDb = {
  prepare: (sql: string) => { get: (...args: unknown[]) => unknown };
};

let _adminDb: AdminDb | null = null;

function getAdminDb(): AdminDb | null {
  if (_adminDb) return _adminDb;
  if (!fs.existsSync(ADMIN_DB_PATH)) return null;
  try {
    const Database = require('better-sqlite3');
    _adminDb = new Database(ADMIN_DB_PATH, { readonly: true, fileMustExist: true }) as AdminDb;
    return _adminDb;
  } catch {
    return null;
  }
}

/** Map an app-level username to the OS shell user (falls back to the same name). */
export function lookupShellUser(appUsername: string): string {
  const db = getAdminDb();
  if (!db) return appUsername;
  try {
    const row = db.prepare('SELECT shell_user FROM users WHERE username = ?').get(appUsername) as
      | { shell_user?: string }
      | undefined;
    return row?.shell_user || appUsername;
  } catch {
    return appUsername;
  }
}

/** Resolve a shell user's home directory via getent; falls back to platform convention. */
export function resolveHome(shellUser: string): string {
  if (shellUser === os.userInfo().username) return os.homedir();
  try {
    const r = spawnSync('getent', ['passwd', shellUser], { encoding: 'utf-8', timeout: 5000 });
    const home = (r.stdout || '').split(':')[5];
    if (home) return home.trim();
  } catch { /* fall through */ }
  return process.platform === 'darwin' ? `/Users/${shellUser}` : `/home/${shellUser}`;
}

function shellQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Resolve the SSH identity for a shell user: the per-user key if it has been
 * provisioned (review M1), otherwise the shared service key. Terminal opens
 * generate the per-user key; this path only reads it.
 */
function resolveIdentityKey(shellUser: string): string {
  if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/.test(shellUser)) {
    const perUser = path.join(spacesHome(), 'keys', shellUser);
    if (fs.existsSync(perUser)) return perUser;
  }
  return SERVICE_KEY;
}

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a command as the given shell user.
 * When the target matches the server process user, spawns directly.
 * Otherwise SSHes to localhost using the Spaces service key — the same mechanism terminal panes use.
 */
export function execAsUser(shellUser: string, argv: string[], opts: { timeoutMs?: number } = {}): ExecResult {
  const timeout = opts.timeoutMs ?? 10000;
  const processUser = os.userInfo().username;

  if (shellUser === processUser) {
    const [cmd, ...rest] = argv;
    const r = spawnSync(cmd, rest, { encoding: 'utf-8', timeout });
    return {
      status: r.status ?? (r.error ? 1 : 0),
      stdout: r.stdout || '',
      stderr: r.stderr || (r.error?.message ?? ''),
    };
  }

  const remoteCmd = argv.map(shellQuote).join(' ');
  const r = spawnSync(
    'ssh',
    [
      '-4',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${KNOWN_HOSTS}`,
      '-o', 'BatchMode=yes',
      '-i', resolveIdentityKey(shellUser),
      `${shellUser}@localhost`,
      remoteCmd,
    ],
    { encoding: 'utf-8', timeout },
  );
  return {
    status: r.status ?? (r.error ? 1 : 0),
    stdout: r.stdout || '',
    stderr: r.stderr || (r.error?.message ?? ''),
  };
}
