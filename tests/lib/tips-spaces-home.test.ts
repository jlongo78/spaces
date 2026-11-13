import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const { prefsPath } = req('../../bin/lib/tips.js');

describe('tips prefsPath honours SPACES_HOME', () => {
  const saved = process.env.SPACES_HOME;
  afterEach(() => {
    if (saved === undefined) delete process.env.SPACES_HOME;
    else process.env.SPACES_HOME = saved;
  });

  it('uses SPACES_HOME when set', () => {
    const tmp = path.join(os.tmpdir(), 'spaces-home-tips');
    process.env.SPACES_HOME = tmp;
    expect(prefsPath()).toBe(path.join(tmp, 'tui.json'));
  });

  it('falls back to <home>/.spaces when blank', () => {
    process.env.SPACES_HOME = '  ';
    expect(prefsPath('/x/home')).toBe(path.join('/x/home', '.spaces', 'tui.json'));
  });
});
