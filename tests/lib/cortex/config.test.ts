import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock tier to simulate Teams tier
vi.mock('@/lib/tier', () => ({
  IS_TEAM: true,
  IS_FEDERATION: false,
  HAS_CORTEX: true,
  TIER: 'team',
  HAS_AUTH: true,
  HAS_MULTIUSER: true,
  HAS_ADMIN: true,
  HAS_COLLABORATION: true,
  HAS_NETWORK: false,
  IS_DESKTOP: false,
}));

import {
  DEFAULT_CORTEX_CONFIG,
  readCortexConfig,
  writeCortexConfig,
  type CortexConfig,
} from '@/lib/cortex/config';

describe('cortex config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has sensible defaults', () => {
    expect(DEFAULT_CORTEX_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CORTEX_CONFIG.embedding.provider).toBe('auto');
    expect(DEFAULT_CORTEX_CONFIG.injection.max_tokens).toBe(2000);
    expect(DEFAULT_CORTEX_CONFIG.injection.max_results).toBe(5);
    expect(DEFAULT_CORTEX_CONFIG.federation.sync_mode).toBe('query-only');
  });

  it('reads config from file', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      cortex: { enabled: false, injection: { max_tokens: 500 } },
    }));

    const config = readCortexConfig(configPath);
    expect(config.enabled).toBe(false);
    expect(config.injection.max_tokens).toBe(500);
    // Unspecified fields get defaults
    expect(config.injection.max_results).toBe(5);
    expect(config.embedding.provider).toBe('auto');
  });

  it('returns defaults when no cortex key exists', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ installId: 'abc' }));

    const config = readCortexConfig(configPath);
    expect(config).toEqual(DEFAULT_CORTEX_CONFIG);
  });

  it('writes cortex config preserving other keys', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      installId: 'abc',
      devDirectories: ['/home/user/dev'],
    }));

    writeCortexConfig(configPath, { enabled: false });

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.installId).toBe('abc');
    expect(raw.devDirectories).toEqual(['/home/user/dev']);
    expect(raw.cortex.enabled).toBe(false);
  });
});
