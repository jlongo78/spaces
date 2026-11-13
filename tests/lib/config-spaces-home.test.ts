import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getUserPaths } from '@/lib/config';

describe('getUserPaths with SPACES_HOME', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-cfg-'));
    vi.stubEnv('SPACES_HOME', tmp);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('puts the local user under SPACES_HOME', () => {
    const p = getUserPaths(os.userInfo().username);
    expect(p.dbPath).toBe(path.join(tmp, 'spaces.db'));
    expect(p.configPath).toBe(path.join(tmp, 'config.json'));
  });

  it('puts other users under SPACES_HOME/users/<name>', () => {
    const p = getUserPaths('someone-else-xyz');
    expect(p.dbPath).toBe(path.join(tmp, 'users', 'someone-else-xyz', 'spaces.db'));
  });
});
