import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

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
  if (process.env.NEXT_PUBLIC_EDITION === 'server') {
    try {
      const { resolveShellUser } = require('./db/admin');
      resolvedUser = resolveShellUser(username);
    } catch {
      // admin DB not available yet (e.g., setup not run)
    }
  }

  const homeDir = resolvedUser === os.userInfo().username ? os.homedir() : `/home/${resolvedUser}`;
  return {
    claudeDir: path.join(homeDir, '.claude'),
    claudeProjectsDir: path.join(homeDir, '.claude', 'projects'),
    statsPath: path.join(homeDir, '.claude', 'stats-cache.json'),
    spacesDir: path.join(homeDir, '.spaces'),
    dbPath: path.join(homeDir, '.spaces', 'spaces.db'),
    configPath: path.join(homeDir, '.spaces', 'config.json'),
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
}

export function readConfig(username: string): SpacesConfig {
  const { configPath, spacesDir } = getUserPaths(username);
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return {
        installId: raw.installId || crypto.randomUUID(),
        telemetryOptOut: !!raw.telemetryOptOut,
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
