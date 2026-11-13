// tests/proto/files.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dispatchFile, MAX_CHUNK } from '../../bin/lib/runtime/files.js';

// The file browser's server half. Most of these are about the boundary.

let home: string, dev: string;
const call = (method: string, params: any = {}) => dispatchFile(method, params, { devRoots: [dev], home }) as any;
const b64 = (s: string) => Buffer.from(s).toString('base64');
const canLink = (target: string, link: string) => {
  try {
    fs.symlinkSync(target, link, fs.statSync(target).isDirectory() ? 'junction' : 'file');
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  // The on-disk spelling (long names, real case), as the policy resolves it.
  home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-files-')));
  dev = path.join(home, 'development');
  for (const d of ['development/app/src', '.spaces', '.ssh', '.claude/projects/-app', 'outside']) {
    fs.mkdirSync(path.join(home, d), { recursive: true });
  }
  fs.writeFileSync(path.join(dev, 'app', 'README.md'), '# hi\n');
  fs.writeFileSync(path.join(dev, 'app', '.env'), 'X=1\n');
  fs.writeFileSync(path.join(home, '.spaces', 'internal_token'), 'secret');
  fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), 'key');
  fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), 'creds');
  fs.writeFileSync(path.join(home, '.claude', 'projects', '-app', 's.jsonl'), '{}');
  fs.writeFileSync(path.join(home, 'outside', 'notes.txt'), 'private');
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('fs.list', () => {
  it('lists folders first, then files, dotfiles included', () => {
    const r = call('fs.list', { path: path.join(dev, 'app') });
    expect(r.result.entries.map((e: any) => [e.name, e.type])).toEqual([
      ['src', 'dir'], ['.env', 'file'], ['README.md', 'file'],
    ]);
    expect(r.result.parent).toBe(dev);
  });

  it('starts at the first dev directory, with nowhere above it', () => {
    const r = call('fs.list');
    expect(r.result.current).toBe(dev);
    expect(r.result.parent).toBeNull();
    expect(r.result.roots).toContain(path.join(home, '.claude', 'projects'));
  });

  it('refuses everything outside the dev directories and transcript stores', () => {
    fs.mkdirSync(dev + '-evil');
    for (const p of [home, path.join(home, 'outside'), path.join(dev, '..'), path.join(home, '.claude'), dev + '-evil']) {
      expect(call('fs.list', { path: p }).code, p).toBe('bad_request');
    }
  });

  it('allows the transcript stores', () => {
    expect(call('fs.list', { path: path.join(home, '.claude', 'projects') }).ok).toBe(true);
  });
});

describe('credential folders are refused even inside an allowed root', () => {
  const asHome = (method: string, params: any) => dispatchFile(method, params, { devRoots: [home], home }) as any;

  it('when home itself is a dev directory', () => {
    for (const p of [
      path.join(home, '.spaces', 'internal_token'),
      path.join(home, '.ssh', 'id_ed25519'),
      path.join(home, '.claude', '.credentials.json'),
    ]) {
      expect(asHome('fs.read', { path: p }).code, p).toBe('bad_request');
      expect(asHome('fs.delete', { path: p }).code, p).toBe('bad_request');
    }
    const names = asHome('fs.list', { path: home }).result.entries.map((e: any) => e.name);
    expect(names).toContain('development');
    expect(names).not.toContain('.spaces');
    expect(names).not.toContain('.ssh');
    expect(names).not.toContain('.claude');
    // The transcript store inside ~/.claude is still reachable directly.
    expect(asHome('fs.read', { path: path.join(home, '.claude', 'projects', '-app', 's.jsonl') }).ok).toBe(true);
  });

  it('cannot write into ~/.spaces or ~/.ssh by naming a new file there', () => {
    expect(asHome('fs.write', { path: path.join(home, '.spaces', 'config.json'), data: b64('{}'), mode: 'truncate' }).code).toBe('bad_request');
    expect(asHome('fs.write', { path: path.join(home, '.ssh', 'authorized_keys'), data: b64('k'), mode: 'create' }).code).toBe('bad_request');
    expect(asHome('fs.mkdir', { path: path.join(home, '.spaces', 'x') }).code).toBe('bad_request');
  });
});

describe('a custom SPACES_HOME is refused like ~/.spaces', () => {
  it('refuses the data folder inside a dev root, still allows its neighbours', () => {
    const data = path.join(dev, 'spacesdata');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'admin.db'), 'db');
    fs.writeFileSync(path.join(dev, 'other.txt'), 'ok');
    vi.stubEnv('SPACES_HOME', data);
    expect(call('fs.read', { path: path.join(data, 'admin.db') }).ok).toBe(false);
    expect(call('fs.write', { path: path.join(data, 'x'), data: b64('k'), mode: 'create' }).ok).toBe(false);
    expect(call('fs.read', { path: path.join(dev, 'other.txt') }).ok).toBe(true);
  });

  it('refuses everything when SPACES_HOME is a file (fails closed)', () => {
    const file = path.join(dev, 'afile');
    fs.writeFileSync(file, 'x');
    fs.writeFileSync(path.join(dev, 'other.txt'), 'ok');
    vi.stubEnv('SPACES_HOME', file);
    expect(call('fs.read', { path: path.join(dev, 'other.txt') }).ok).toBe(false);
  });
});

describe('spellings that name a refused folder', () => {
  const asHome = (method: string, params: any) => dispatchFile(method, params, { devRoots: [home], home }) as any;
  const insensitive = process.platform === 'win32' || process.platform === 'darwin';

  it.runIf(insensitive)('another letter case is the same folder', () => {
    for (const p of [
      path.join(home, '.SPACES', 'internal_token'),
      path.join(home, '.Ssh', 'id_ed25519'),
      path.join(home, '.CLAUDE', '.credentials.json'),
    ]) {
      expect(asHome('fs.read', { path: p }).code, p).toBe('bad_request');
      expect(asHome('fs.write', { path: p, data: b64('x'), mode: 'truncate' }).code, p).toBe('bad_request');
      expect(asHome('fs.delete', { path: p }).code, p).toBe('bad_request');
    }
    expect(asHome('fs.list', { path: path.join(home, '.SPACES') }).code).toBe('bad_request');
  });

  it.runIf(process.platform === 'win32')('NTFS streams and trailing dots are refused', () => {
    for (const p of [
      path.join(home, '.spaces::$INDEX_ALLOCATION', 'internal_token'),
      path.join(dev, 'app', 'README.md:hidden'),
      path.join(home, '.ssh.', 'id_ed25519'),
      path.join(home, '.ssh ', 'id_ed25519'),
    ]) {
      expect(asHome('fs.read', { path: p }).code, p).toBe('bad_request');
      expect(asHome('fs.write', { path: p, data: b64('x'), mode: 'truncate' }).code, p).toBe('bad_request');
    }
  });

  it.runIf(process.platform === 'win32')('an 8.3 short name is the folder it stands for', () => {
    const short = require('node:child_process')
      .execSync(`cmd /c for %I in ("${path.join(home, '.spaces')}") do @echo %~sI`, { encoding: 'utf-8' }).trim();
    if (!short || short.toLowerCase().endsWith('.spaces')) return; // short names off on this volume
    expect(asHome('fs.read', { path: path.join(short, 'internal_token') }).code).toBe('bad_request');
  });
});

describe('symlinks', () => {
  it('will not write through a dangling link', () => {
    const outsideTarget = path.join(home, 'outside', 'planted.txt');
    const link = path.join(dev, 'app', 'notes.txt.spaces-upload');
    try { fs.symlinkSync(outsideTarget, link, 'file'); } catch { return; }
    expect(call('fs.write', { path: link, data: b64('x'), mode: 'truncate' }).code).toBe('bad_request');
    expect(fs.existsSync(outsideTarget)).toBe(false);
  });

  it('cannot read or list through a link that leads outside', () => {
    if (!canLink(path.join(home, 'outside'), path.join(dev, 'escape'))) return;
    expect(call('fs.list', { path: path.join(dev, 'escape') }).code).toBe('bad_request');
    expect(call('fs.read', { path: path.join(dev, 'escape', 'notes.txt') }).code).toBe('bad_request');
    expect(call('fs.list', { path: dev }).result.entries.map((e: any) => e.name)).not.toContain('escape');
  });

  it('cannot write through a link into ~/.spaces', () => {
    if (!canLink(path.join(home, '.spaces'), path.join(dev, 'sp'))) return;
    expect(call('fs.write', { path: path.join(dev, 'sp', 'x'), data: b64('x'), mode: 'create' }).code).toBe('bad_request');
  });

  it('deleting a link removes the link, never its target', () => {
    const target = path.join(dev, 'app', 'src');
    if (!canLink(target, path.join(dev, 'shortcut'))) return;
    fs.writeFileSync(path.join(target, 'keep.ts'), 'x');
    expect(call('fs.delete', { path: path.join(dev, 'shortcut') }).ok).toBe(true);
    expect(fs.existsSync(path.join(target, 'keep.ts'))).toBe(true);
  });
});

describe('fs.read', () => {
  it('reads in chunks with an end marker', () => {
    const file = path.join(dev, 'app', 'README.md');
    const a = call('fs.read', { path: file, length: 3 }).result;
    expect(Buffer.from(a.data, 'base64').toString()).toBe('# h');
    expect(a.eof).toBe(false);
    const b = call('fs.read', { path: file, offset: 3 }).result;
    expect(Buffer.from(b.data, 'base64').toString()).toBe('i\n');
    expect(b.eof).toBe(true);
    expect(b.size).toBe(5);
  });

  it('refuses a folder, a huge chunk and a negative offset', () => {
    const readme = path.join(dev, 'app', 'README.md');
    expect(call('fs.read', { path: dev }).code).toBe('bad_request');
    expect(call('fs.read', { path: readme, length: MAX_CHUNK + 1 }).code).toBe('bad_request');
    expect(call('fs.read', { path: readme, offset: -1 }).code).toBe('bad_request');
  });
});

describe('fs.write', () => {
  const file = () => path.join(dev, 'app', 'new.txt');

  it('creates, appends and replaces', () => {
    expect(call('fs.write', { path: file(), data: b64('ab') }).ok).toBe(true);
    expect(call('fs.write', { path: file(), data: b64('cd'), mode: 'append' }).ok).toBe(true);
    expect(fs.readFileSync(file(), 'utf-8')).toBe('abcd');
    expect(call('fs.write', { path: file(), data: b64('z'), mode: 'truncate' }).result.size).toBe(1);
  });

  it('will not create over an existing file', () => {
    expect(call('fs.write', { path: path.join(dev, 'app', 'README.md'), data: b64('x') }).code).toBe('conflict');
  });

  it('refuses a save over a file changed since it was opened', () => {
    const readme = path.join(dev, 'app', 'README.md');
    const { mtime } = call('fs.read', { path: readme }).result;
    expect(call('fs.write', { path: readme, data: b64('v2'), mode: 'truncate', expectMtime: mtime }).ok).toBe(true);
    expect(call('fs.write', { path: readme, data: b64('v3'), mode: 'truncate', expectMtime: mtime - 60_000 }).code).toBe('conflict');
    expect(fs.readFileSync(readme, 'utf-8')).toBe('v2');
  });

  it('refuses data that is not base64 or too large', () => {
    expect(call('fs.write', { path: file(), data: 'not base64!' }).code).toBe('bad_request');
    expect(call('fs.write', { path: file(), data: Buffer.alloc(MAX_CHUNK + 1).toString('base64') }).code).toBe('bad_request');
  });
});

describe('fs.mkdir, fs.move, fs.delete', () => {
  it('creates a folder once', () => {
    expect(call('fs.mkdir', { path: path.join(dev, 'app', 'lib') }).ok).toBe(true);
    expect(call('fs.mkdir', { path: path.join(dev, 'app', 'lib') }).code).toBe('conflict');
  });

  it('renames, refuses to overwrite unless asked, and never into itself', () => {
    const a = path.join(dev, 'app', 'README.md');
    const b = path.join(dev, 'app', 'GUIDE.md');
    expect(call('fs.move', { from: a, to: b }).ok).toBe(true);
    fs.writeFileSync(a, 'again');
    expect(call('fs.move', { from: a, to: b }).code).toBe('conflict');
    expect(call('fs.move', { from: a, to: b, overwrite: true }).ok).toBe(true);
    expect(call('fs.move', { from: path.join(dev, 'app'), to: path.join(dev, 'app', 'src', 'app') }).code).toBe('bad_request');
  });

  it('cannot move a file out of bounds or a secret in', () => {
    expect(call('fs.move', { from: path.join(dev, 'app', 'README.md'), to: path.join(home, 'outside', 'r.md') }).code).toBe('bad_request');
    expect(call('fs.move', { from: path.join(home, '.spaces', 'internal_token'), to: path.join(dev, 't') }).code).toBe('bad_request');
  });

  it('deletes folders recursively, but never a root', () => {
    expect(call('fs.delete', { path: path.join(dev, 'app') }).ok).toBe(true);
    expect(fs.existsSync(path.join(dev, 'app'))).toBe(false);
    expect(call('fs.delete', { path: dev }).code).toBe('bad_request');
    expect(call('fs.delete', { path: path.join(home, '.claude', 'projects') }).code).toBe('bad_request');
  });

  it('reports a missing entry as not_found', () => {
    expect(call('fs.delete', { path: path.join(dev, 'nope') }).code).toBe('not_found');
  });
});

describe('params', () => {
  it('requires a path, and string paths only', () => {
    expect(call('fs.read', {}).code).toBe('bad_request');
    expect(call('fs.list', { path: 7 }).code).toBe('bad_request');
    expect(call('fs.move', { from: path.join(dev, 'app') }).code).toBe('bad_request');
  });
});
