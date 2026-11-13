import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findUnknownFlag } from '../../bin/lib/cli-flags.js';

describe('findUnknownFlag', () => {
  it('accepts every flag the launcher recognises', () => {
    const accepted: string[][] = [
      [],
      ['--setup'],
      ['--port', '4000'],
      ['--multiuser', '--experimental'],
      ['--desktop'],
      ['--no-multiuser'],
      ['--federate', 'tailscale0', '--federation-port', '3480', '--federation-public-interface'],
      ['--base-path', '/spaces'],
      ['--remote', 'me@host'],
      ['--help'], ['-h'],
      ['--version'], ['-v'],
      ['whoami', '--federate', '100.64.0.1'],
      ['tui', '--desktop', '--port', '4000', '--url', 'ws://127.0.0.1:4000', '--token', 't'],
      ['tui', '--remote', 'me@host'],
      ['--remote', 'me@host', '--yes'], ['--remote', 'me@host', '-y'],
      ['status'], ['status', '--porcelain'], ['restart'],
      ['start', '--print-token'], ['start', '--print-token', '--print-login'], ['open', '--remote', 'me@host'],
      ['start', '--multiuser', '--experimental'],
      ['stop', '--port', '4000'],
      ['open'], ['web'], ['web', '--remote', 'me@host'], ['signout'], ['guide'],
    ];
    for (const args of accepted) expect(findUnknownFlag(args), args.join(' ')).toBeNull();
  });

  it('does not judge the arguments of commands handled by another script', () => {
    expect(findUnknownFlag(['service', 'install', '--whatever'])).toBeNull();
    expect(findUnknownFlag(['reset-totp', '-weird-user'])).toBeNull();
    expect(findUnknownFlag(['upgrade', '--force'])).toBeNull();
    expect(findUnknownFlag(['uninstall', '--yes'])).toBeNull();
  });

  it('reports a flag nothing recognises', () => {
    expect(findUnknownFlag(['--verison'])).toBe('--verison');
    expect(findUnknownFlag(['--port=4000'])).toBe('--port=4000');
    expect(findUnknownFlag(['tui', '--bogus'])).toBe('--bogus');
    expect(findUnknownFlag(['-x'])).toBe('-x');
  });

  it('does not mistake a flag value for a flag', () => {
    expect(findUnknownFlag(['--token', '-starts-with-dash'])).toBeNull();
    expect(findUnknownFlag(['--base-path', '-odd'])).toBeNull();
  });
});

// The launcher itself, run with a throwaway HOME so nothing touches the real
// ~/.spaces, and on a spare port. None of these cases binds a port.
describe('spaces CLI', () => {
  const launcher = path.join(__dirname, '..', '..', 'bin', 'spaces.js');
  const version = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
  ).version;
  let home: string;

  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'spaces-cli-test-'));
  });
  afterAll(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const run = (args: string[], env: Record<string, string> = {}) => {
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      ...env,
    };
    for (const k of ['SPACES_MULTIUSER', 'SPACES_EXPERIMENTAL', 'SPACES_PORT', '__SPACES_HEAP']) {
      if (!(k in env)) delete childEnv[k];
    }
    return spawnSync(process.execPath, [launcher, ...args], {
      env: childEnv as NodeJS.ProcessEnv,
      encoding: 'utf-8',
      timeout: 30000,
    });
  };

  it('spaces tips off and on write the setting the terminal client reads', () => {
    const file = path.join(home, '.spaces', 'tui.json');
    expect(run(['tips']).stdout).toContain('Tips are on');
    expect(run(['tips', 'off']).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ tips: false });
    expect(run(['tips']).stdout).toContain('Tips are off');
    fs.writeFileSync(file, JSON.stringify({ tips: false, other: 1 }));
    expect(run(['tips', 'on']).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ tips: true, other: 1 });
    const bad = run(['tips', 'maybe']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('spaces tips off');
  });

  it('a bad SPACES_HOME is one clear line and exit 1, not a stack trace', () => {
    const file = path.join(home, 'not-a-folder');
    fs.writeFileSync(file, 'x');
    for (const [value, msg] of [[file, 'is not a folder'], [home, 'home folder']]) {
      const r = run(['--version'], { SPACES_HOME: value });
      expect(r.status, value).toBe(1);
      expect(r.stderr).toContain('SPACES_HOME');
      expect(r.stderr).toContain(msg);
      expect(r.stderr).not.toMatch(/\n\s+at /);
      expect(r.stdout).not.toContain(version);
    }
  });

  it('--version and -v print the package version and exit 0', () => {
    for (const flag of ['--version', '-v']) {
      const r = run([flag]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(version);
    }
  });

  it('an unknown flag exits 2 with a pointer to --help', () => {
    const r = run(['--no-such-flag', '--port', '4491']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Unknown option: --no-such-flag');
    expect(r.stderr).toContain('spaces --help');
  });

  it('--help documents spaces web, and bare spaces as the terminal client', () => {
    const r = run(['--help']);
    expect(r.stdout).toMatch(/spaces web\s+Open the web app/);
    expect(r.stdout).toMatch(/spaces web --remote you@host/);
    expect(r.stdout).toMatch(/spaces\s+Open the terminal client/);
    expect(r.stdout).not.toContain('spaces open');
  });

  it('--remote with another command names spaces web, not spaces open', () => {
    const r = run(['status', '--remote', 'me@host']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('"spaces web"');
  });

  it('--help lists --experimental and marks multiuser and federation experimental', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('--experimental');
    expect(r.stdout).toMatch(/--multiuser\s+\[experimental\]/);
    expect(r.stdout).toMatch(/--federate <iface>\s+\[experimental\]/);
    expect(r.stdout).toContain('--version');
  });

  it('refuses multiuser mode without --experimental, exit 1', () => {
    for (const [args, env] of [
      [['--multiuser', '--port', '4492'], {}],
      [['--port', '4492'], { SPACES_MULTIUSER: '1' }],
    ] as const) {
      const r = run([...args], { ...env });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/multiuser mode is experimental/i);
      expect(r.stderr).toContain('--experimental');
    }
  });

  it('refuses a saved multiuser setting too, unless SPACES_EXPERIMENTAL is set', () => {
    fs.mkdirSync(path.join(home, '.spaces'), { recursive: true });
    fs.writeFileSync(path.join(home, '.spaces', 'server.json'), JSON.stringify({ multiuser: true }));
    try {
      const r = run(['--port', '4493']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('server.json');
    } finally {
      fs.rmSync(path.join(home, '.spaces', 'server.json'), { force: true });
    }
  });
});
