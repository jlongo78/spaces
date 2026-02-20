import path from 'path';
import fs from 'fs';
import os from 'os';

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
  const homeDir = username === os.userInfo().username ? os.homedir() : `/home/${username}`;
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
