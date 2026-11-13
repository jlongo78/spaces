// tests/lib/spaces-home.test.ts
// One table, two copies: bin/lib/spaces-home.js and src/lib/spaces-home.ts
// must behave identically.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain JS module without types
import { spacesHome as jsImpl } from '../../bin/lib/spaces-home.js';
import { spacesHome as tsImpl } from '@/lib/spaces-home';

describe.each([
  ['bin', jsImpl as (home?: string) => string],
  ['src', tsImpl as (home?: string) => string],
])('spacesHome (%s)', (_name, spacesHome) => {
  let tmp: string;

  beforeEach(() => {
    vi.stubEnv('SPACES_HOME', '');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-home-'));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('defaults to <homedir>/.spaces when unset', () => {
    expect(spacesHome()).toBe(path.join(os.homedir(), '.spaces'));
  });

  it('treats a whitespace-only value as unset', () => {
    vi.stubEnv('SPACES_HOME', '   ');
    expect(spacesHome()).toBe(path.join(os.homedir(), '.spaces'));
  });

  it('uses the home argument as the base for the default', () => {
    expect(spacesHome('/x/home')).toBe(path.join('/x/home', '.spaces'));
  });

  it('lets a set SPACES_HOME win over the home argument', () => {
    const data = path.join(tmp, 'data');
    vi.stubEnv('SPACES_HOME', data);
    expect(spacesHome('/x/home')).toBe(data);
  });

  it('expands a leading ~', () => {
    vi.stubEnv('SPACES_HOME', '~/sp');
    expect(spacesHome()).toBe(path.join(os.homedir(), 'sp'));
    vi.stubEnv('SPACES_HOME', '~');
    expect(spacesHome()).toBe(os.homedir());
  });

  it('resolves a relative path against the cwd', () => {
    vi.stubEnv('SPACES_HOME', 'rel/dir');
    expect(spacesHome()).toBe(path.resolve('rel/dir'));
  });

  it('drops a trailing separator', () => {
    const data = path.join(tmp, 'data');
    vi.stubEnv('SPACES_HOME', data + path.sep);
    expect(spacesHome()).toBe(data);
  });

  it('throws when the path is an existing file', () => {
    const file = path.join(tmp, 'file.txt');
    fs.writeFileSync(file, 'x');
    vi.stubEnv('SPACES_HOME', file);
    expect(() => spacesHome()).toThrow(/SPACES_HOME.*is not a folder/);
  });

  it('returns a missing folder without creating it', () => {
    const missing = path.join(tmp, 'nope');
    vi.stubEnv('SPACES_HOME', missing);
    expect(spacesHome()).toBe(missing);
    expect(fs.existsSync(missing)).toBe(false);
  });
});
