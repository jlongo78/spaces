import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { HAS_MULTIUSER } from '@/lib/tier';

export const config = {
  // Server
  port: parseInt(process.env.SPACES_PORT || '3457', 10),

  // Cost rates ($ per 1M tokens)
  costRates: {
    'claude-opus-4-5-20251101': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    'claude-sonnet-4-5-20250929': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  } as Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }>,
};

export function getUserPaths(username: string) {
  // In server mode, resolve the app username to the OS shell user
  let resolvedUser = username;
  if (HAS_MULTIUSER) {
    try {
      const pro = require('@spaces/pro');
      resolvedUser = pro.admin.resolveShellUser(username);
    } catch {
      // @spaces/pro not available or admin DB not ready
    }
  }

  // Agent session data lives in the shell user's home (read-only access via group perms)
  const homeDir = resolvedUser === os.userInfo().username ? os.homedir() : `/home/${resolvedUser}`;

  // Spaces writable data is centralized under the app process owner's home
  // so we don't need write access to other users' home directories
  const isLocalUser = resolvedUser === os.userInfo().username;
  const spacesDir = isLocalUser
    ? path.join(os.homedir(), '.spaces')
    : path.join(os.homedir(), '.spaces', 'users', username);

  return {
    claudeDir: path.join(homeDir, '.claude'),
    claudeProjectsDir: path.join(homeDir, '.claude', 'projects'),
    statsPath: path.join(homeDir, '.claude', 'stats-cache.json'),
    codexDir: path.join(homeDir, '.codex'),
    codexSessionsDir: path.join(homeDir, '.codex', 'sessions'),
    geminiDir: path.join(homeDir, '.gemini'),
    geminiChatsBaseDir: path.join(homeDir, '.gemini', 'tmp'),
    geminiProjectsRegistry: path.join(homeDir, '.gemini', 'projects.json'),
    spacesDir,
    dbPath: path.join(spacesDir, 'spaces.db'),
    configPath: path.join(spacesDir, 'config.json'),
  };
}

export function ensureUserSpacesDir(username: string) {
  const { spacesDir } = getUserPaths(username);
  if (!fs.existsSync(spacesDir)) {
    fs.mkdirSync(spacesDir, { recursive: true });
  }
}

export interface SpacesConfig {
  installId: string;
  telemetryOptOut: boolean;
  devDirectories: string[];
}

export function readConfig(username: string): SpacesConfig {
  const { configPath, spacesDir } = getUserPaths(username);
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        installId: raw.installId || crypto.randomUUID(),
        telemetryOptOut: !!raw.telemetryOptOut,
        devDirectories: Array.isArray(raw.devDirectories) ? raw.devDirectories.filter((d: unknown) => typeof d === 'string') : [],
      };
    }
  } catch { /* corrupt file, recreate */ }

  // Create fresh config
  if (!fs.existsSync(spacesDir)) {
    fs.mkdirSync(spacesDir, { recursive: true });
  }
  const config: SpacesConfig = {
    installId: crypto.randomUUID(),
    telemetryOptOut: false,
    devDirectories: [],
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return config;
}

export function writeConfig(username: string, updates: Partial<SpacesConfig>) {
  const current = readConfig(username);
  const merged = { ...current, ...updates };
  const { configPath } = getUserPaths(username);
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
  return merged;
}
