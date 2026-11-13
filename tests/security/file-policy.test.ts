import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFilePath } from '@/lib/file-policy';

// The web app's file viewer: the same cases as tests/proto/files.test.ts.

let home: string, dev: string, server: string;
const check = (p: string, roots = [dev]) => checkFilePath(p, { homes: [home, server], roots });

beforeEach(() => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-webpolicy-')));
  home = path.join(base, 'user');
  server = path.join(base, 'owner');
  dev = path.join(home, 'dev');
  for (const d of ['user/dev/app', 'user/.ssh', 'user/.claude/projects/-app', 'owner/.spaces', 'outside']) {
    fs.mkdirSync(path.join(base, d), { recursive: true });
  }
  fs.writeFileSync(path.join(dev, 'app', 'a.txt'), 'x');
  fs.writeFileSync(path.join(home, '.ssh', 'id_rsa'), 'k');
  fs.writeFileSync(path.join(server, '.spaces', 'session_secret'), 's');
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(path.dirname(home), { recursive: true, force: true });
});

describe('checkFilePath', () => {
  it('refuses a custom SPACES_HOME like ~/.spaces, and allows its neighbours', () => {
    const data = path.join(dev, 'spacesdata');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'admin.db'), 'db');
    fs.writeFileSync(path.join(dev, 'other.txt'), 'ok');
    vi.stubEnv('SPACES_HOME', data);
    expect(check(path.join(data, 'admin.db'))).toBeNull();
    expect(check(path.join(data, 'new.txt'))).toBeNull();
    expect(check(path.join(dev, 'other.txt'))).toBe(path.join(dev, 'other.txt'));
  });

  it('refuses everything when SPACES_HOME is a file (fails closed)', () => {
    const file = path.join(dev, 'afile');
    fs.writeFileSync(file, 'x');
    fs.writeFileSync(path.join(dev, 'other.txt'), 'ok');
    vi.stubEnv('SPACES_HOME', file);
    expect(check(path.join(dev, 'other.txt'))).toBeNull();
  });

  it('allows files in the dev directories, new ones included', () => {
    expect(check(path.join(dev, 'app', 'a.txt'))).toBe(path.join(dev, 'app', 'a.txt'));
    expect(check(path.join(dev, 'app', 'new.txt'))).toBe(path.join(dev, 'app', 'new.txt'));
  });

  it('refuses outside the roots, including by ..', () => {
    expect(check(path.join(path.dirname(home), 'outside'))).toBeNull();
    expect(check(path.join(dev, '..', '..', 'outside'))).toBeNull();
  });

  it('refuses the server account\'s own ~/.spaces even when a root contains it', () => {
    expect(check(path.join(server, '.spaces', 'session_secret'), [server])).toBeNull();
  });

  it('refuses the user\'s credential folders even when home is a root', () => {
    expect(check(path.join(home, '.ssh', 'id_rsa'), [home])).toBeNull();
    expect(check(path.join(home, '.claude', 'settings.json'), [home])).toBeNull();
    expect(check(path.join(home, '.claude', 'projects', '-app'), [home])).not.toBeNull();
  });

  it.runIf(process.platform === 'win32' || process.platform === 'darwin')('another letter case is the same folder', () => {
    expect(check(path.join(home, '.SSH', 'id_rsa'), [home])).toBeNull();
    expect(check(path.join(server, '.Spaces', 'session_secret'), [server])).toBeNull();
  });

  it.runIf(process.platform === 'win32')('NTFS streams and trailing dots are refused', () => {
    expect(check(path.join(dev, 'app', 'a.txt:hidden'))).toBeNull();
    expect(check(path.join(home, '.ssh.', 'id_rsa'), [home])).toBeNull();
  });

  it('refuses a dangling symlink', () => {
    const link = path.join(dev, 'app', 'up.part');
    try { fs.symlinkSync(path.join(home, '.ssh', 'authorized_keys'), link, 'file'); } catch { return; }
    expect(check(link)).toBeNull();
  });
});
