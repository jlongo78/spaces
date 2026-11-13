import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOOK = path.resolve(__dirname, '../../bin/spaces-hook.js');

function run(spacesHome: string, tmpHome: string, pane: string) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith('SPACES_')) env[k] = v;
  }
  Object.assign(env, { SPACES_HOME: spacesHome, HOME: tmpHome, USERPROFILE: tmpHome });
  return spawnSync(process.execPath, [HOOK, pane], {
    env,
    input: JSON.stringify({ hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
    timeout: 15000,
  });
}

describe('bin/spaces-hook.js SPACES_HOME', () => {
  it('loads hook-env from SPACES_HOME and writes hook-state there', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-home-'));
    const sh = path.join(tmp, 'data');
    fs.mkdirSync(path.join(sh, 'hook-env'), { recursive: true });
    fs.writeFileSync(
      path.join(sh, 'hook-env', 'pane1.json'),
      JSON.stringify({
        SPACES_PANE_ID: 'pane1',
        SPACES_WORKSPACE_ID: 'ws1',
        SPACES_API_URL: 'http://127.0.0.1:1',
      }),
    );
    try {
      const r = run(sh, tmp, 'pane1');
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(sh, 'hook-state', 'pane1.json'))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exits 0 quietly when SPACES_HOME is a file', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-home-'));
    const file = path.join(tmp, 'afile');
    fs.writeFileSync(file, 'x');
    try {
      const r = run(file, tmp, 'pane1');
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
