import fs from 'fs';
import path from 'path';
import { spacesHome } from '@/lib/spaces-home';

const SERVER_CONFIG_PATH = path.join(spacesHome(), 'server.json');

export interface ServerConfig {
  port?: number;
  basePath?: string;
  allowedOrigins?: string;
  multiuser?: boolean;
}

export function readServerConfig(): ServerConfig {
  try {
    if (fs.existsSync(SERVER_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(SERVER_CONFIG_PATH, 'utf-8'));
    }
  } catch {
    // corrupt — treat as empty
  }
  return {};
}

export function writeServerConfig(updates: Partial<ServerConfig>): ServerConfig {
  const current = readServerConfig();
  const merged = { ...current, ...updates };
  const dir = path.dirname(SERVER_CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SERVER_CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}
