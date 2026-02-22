import { PostHog } from 'posthog-node';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const POSTHOG_KEY = 'phc_placeholder';
const POSTHOG_HOST = 'https://us.i.posthog.com';

let client: PostHog | null = null;
let installId: string = '';
let optedOut = false;

interface SpacesConfig {
  installId: string;
  telemetryOptOut: boolean;
}

function configPath(): string {
  return path.join(os.homedir(), '.spaces', 'config.json');
}

function loadConfig(): SpacesConfig {
  const cfgPath = configPath();
  try {
    if (fs.existsSync(cfgPath)) {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      return {
        installId: raw.installId || crypto.randomUUID(),
        telemetryOptOut: !!raw.telemetryOptOut,
      };
    }
  } catch { /* corrupt, recreate */ }

  const dir = path.dirname(cfgPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const cfg: SpacesConfig = {
    installId: crypto.randomUUID(),
    telemetryOptOut: false,
  };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return cfg;
}

function isDev(): boolean {
  return !app.isPackaged && !process.env.SPACES_TELEMETRY_DEV;
}

function shouldTrack(): boolean {
  return client !== null && !optedOut && !isDev();
}

export function initMainTelemetry() {
  if (isDev()) return;

  const cfg = loadConfig();
  installId = cfg.installId;
  optedOut = cfg.telemetryOptOut;

  if (optedOut) return;

  client = new PostHog(POSTHOG_KEY, {
    host: POSTHOG_HOST,
    flushAt: 5,
    flushInterval: 30000,
  });
}

export function identifyInstall() {
  if (!shouldTrack() || !client) return;
  client.identify({
    distinctId: installId,
    properties: {
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
    },
  });
}

export function trackMain(event: string, properties?: Record<string, unknown>) {
  if (!shouldTrack() || !client) return;
  client.capture({
    distinctId: installId,
    event,
    properties: {
      platform: process.platform,
      arch: process.arch,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      ...properties,
    },
  });
}

export function reloadTelemetryConfig() {
  const cfg = loadConfig();
  optedOut = cfg.telemetryOptOut;
  if (optedOut && client) {
    shutdownMainTelemetry();
  } else if (!optedOut && !client && !isDev()) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 5,
      flushInterval: 30000,
    });
  }
}

export async function shutdownMainTelemetry() {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
