import { describe, it, expect } from 'vitest';
import { systemdEnv, plistEnv, cmdSet } from '../../bin/lib/service-env.js';

describe('systemdEnv', () => {
  it('quotes the whole assignment so spaces survive', () => {
    expect(systemdEnv('SPACES_HOME', '/a b/c')).toBe('Environment="SPACES_HOME=/a b/c"');
  });
  it('backslash-escapes quotes and backslashes', () => {
    expect(systemdEnv('X', 'a"b\\c')).toBe('Environment="X=a\\"b\\\\c"');
  });
  it('doubles % (systemd specifier)', () => {
    expect(systemdEnv('X', '50%')).toBe('Environment="X=50%%"');
  });
});

describe('plistEnv', () => {
  it('returns an indented key/string pair with XML escaping', () => {
    expect(plistEnv('SPACES_HOME', '/x/&<y')).toEqual([
      '      <key>SPACES_HOME</key>',
      '      <string>/x/&amp;&lt;y</string>',
    ]);
  });
});

describe('cmdSet', () => {
  it('quotes the assignment', () => {
    expect(cmdSet('SPACES_HOME', 'C:\\a b\\c')).toBe('set "SPACES_HOME=C:\\a b\\c"');
  });
  it('doubles %', () => {
    expect(cmdSet('X', '100%')).toBe('set "X=100%%"');
  });
});
