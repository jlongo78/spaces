// A Windows data folder outside the user's profile does not inherit the
// profile's owner-only ACL, so the launcher hardens it. Decision logic only;
// icacls is never run here.
import { describe, it, expect } from 'vitest';
// @ts-expect-error plain JS module without types
import { needsOwnerOnlyAcl } from '../../bin/lib/data-dir-acl.js';

const HOME = String.raw`C:\Users\me`;

describe('needsOwnerOnlyAcl', () => {
  it('is false off Windows', () => {
    expect(needsOwnerOnlyAcl('/srv/spaces', '/home/me', 'linux')).toBe(false);
    expect(needsOwnerOnlyAcl('/srv/spaces', '/Users/me', 'darwin')).toBe(false);
  });

  it('is false for a folder inside the profile, in any letter case', () => {
    expect(needsOwnerOnlyAcl(String.raw`C:\Users\me\.spaces`, HOME, 'win32')).toBe(false);
    expect(needsOwnerOnlyAcl(String.raw`c:\users\ME\data\spaces`, HOME, 'win32')).toBe(false);
  });

  it('is true for a folder outside the profile', () => {
    expect(needsOwnerOnlyAcl(String.raw`D:\spaces`, HOME, 'win32')).toBe(true);
    expect(needsOwnerOnlyAcl(String.raw`C:\spaces`, HOME, 'win32')).toBe(true);
    expect(needsOwnerOnlyAcl(String.raw`C:\Users\me-other\spaces`, HOME, 'win32')).toBe(true);
    expect(needsOwnerOnlyAcl(String.raw`C:\Users\other`, HOME, 'win32')).toBe(true);
    expect(needsOwnerOnlyAcl(String.raw`D:\spaces`, HOME, 'win32', 'me')).toBe(true);
  });

  // A system-level service runs as SYSTEM; owner-only would lock the user out.
  it('is false when running as SYSTEM or the machine account', () => {
    expect(needsOwnerOnlyAcl(String.raw`D:\spaces`, HOME, 'win32', 'SYSTEM')).toBe(false);
    expect(needsOwnerOnlyAcl(String.raw`D:\spaces`, HOME, 'win32', 'DESKTOP-1$')).toBe(false);
  });
});
