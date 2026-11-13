// Service definitions must carry SPACES_HOME whenever the service runs as the
// installing user (user level, and system level for yourself); only installs
// for another user ignore it. Generators are exercised directly; no service is
// installed and no icacls/npm is run (child_process is stubbed).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const req = createRequire(import.meta.url);
const SERVICE = req.resolve('../../bin/spaces-service.js');

// Fresh copy per test: the module captures SPACES_DIR at load.
function loadService() {
  delete req.cache[SERVICE];
  return req(SERVICE);
}

describe('spaces-service SPACES_HOME persistence', () => {
  let tmp: string;
  let data: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-home-'));
    data = path.join(tmp, 'custom data');
    fs.mkdirSync(data);
    const cp = req('child_process');
    // resolveSpacesPath() runs `npm root -g`; system wrappers run icacls.
    vi.spyOn(cp, 'execFileSync').mockImplementation(() => { throw new Error('stubbed'); });
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 0 } as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('ProgramData', path.join(tmp, 'ProgramData'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete req.cache[SERVICE];
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('user level + SPACES_HOME: every generator carries it', () => {
    vi.stubEnv('SPACES_HOME', data);
    const svc = loadService();
    expect(svc.persistsSpacesHome('user')).toBe(true);
    expect(svc.linuxUnitFile('user')).toContain(`Environment="SPACES_HOME=${data.replace(/\\/g, '\\\\')}"`);
    expect(svc.darwinPlistContent('user')).toContain(`<string>${data}</string>`);
    const wrapper = fs.readFileSync(svc.win32WrapperScript('user'), 'utf8');
    expect(wrapper).toContain(`set "SPACES_HOME=${data}"`);
  });

  it('system level for yourself + SPACES_HOME: carries it', () => {
    vi.stubEnv('SPACES_HOME', data);
    const svc = loadService();
    svc.setTargetHome(os.homedir());
    expect(svc.persistsSpacesHome('system')).toBe(true);
    expect(svc.linuxUnitFile('system')).toContain('SPACES_HOME=');
    expect(svc.darwinPlistContent('system')).toContain('<key>SPACES_HOME</key>');
    const wrapper = fs.readFileSync(svc.win32WrapperScript('system'), 'utf8');
    expect(wrapper).toContain(`set "SPACES_HOME=${data}"`);
  });

  it('Windows system wrapper points USERPROFILE at the target home, not the custom folder parent', () => {
    vi.stubEnv('SPACES_HOME', data);
    const svc = loadService();
    svc.setTargetHome(os.homedir());
    const wrapper = fs.readFileSync(svc.win32WrapperScript('system'), 'utf8');
    expect(wrapper).toContain(`set USERPROFILE=${os.homedir()}\r\n`);
    expect(wrapper).not.toContain(`set USERPROFILE=${tmp}`);
  });

  it('install for another user: SPACES_HOME is ignored with a warning', () => {
    vi.stubEnv('SPACES_HOME', data);
    const svc = loadService();
    const other = path.join(tmp, 'Users', 'someone-else');
    svc.setTargetHome(other);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('SPACES_HOME is ignored'));
    expect(svc.persistsSpacesHome('system')).toBe(false);
    const wrapper = fs.readFileSync(svc.win32WrapperScript('system'), 'utf8');
    expect(wrapper).not.toContain('SPACES_HOME');
    expect(wrapper).toContain(`set USERPROFILE=${other}\r\n`);
    expect(svc.linuxUnitFile('system')).not.toContain('SPACES_HOME');
  });

  it('unset SPACES_HOME: nothing is persisted at either level', () => {
    vi.stubEnv('SPACES_HOME', '');
    // Point the default folder at tmp so generators never touch the real ~/.spaces.
    vi.spyOn(os, 'homedir').mockReturnValue(tmp);
    const svc = loadService();
    expect(svc.persistsSpacesHome('user')).toBe(false);
    expect(svc.persistsSpacesHome('system')).toBe(false);
    expect(svc.linuxUnitFile('user')).not.toContain('SPACES_HOME');
    expect(svc.linuxUnitFile('system')).not.toContain('SPACES_HOME');
    expect(svc.darwinPlistContent('system')).not.toContain('SPACES_HOME');
    svc.setTargetHome(tmp);
    const wrapper = fs.readFileSync(svc.win32WrapperScript('system'), 'utf8');
    expect(wrapper).not.toContain('SPACES_HOME');
    expect(wrapper).toContain(`set USERPROFILE=${tmp}\r\n`);
  });
});
