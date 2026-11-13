'use strict';
// Windows: a data folder inside the user's profile inherits the profile's
// owner-only ACL. One elsewhere (SPACES_HOME=D:\spaces) inherits e.g. a drive
// root ACL that lets every user read the secrets, so lock it down.
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Pure: does `dir` need explicit owner-only ACLs on this platform? Not when
 * running as SYSTEM (a system-level service): the owner would then be SYSTEM
 * and the user's own `spaces` commands would lose access to the folder.
 */
function needsOwnerOnlyAcl(dir, home, platform = process.platform, username = '') {
  if (platform !== 'win32') return false;
  if (/^system$|\$$/i.test(username)) return false;
  const rel = path.win32.relative(home.toLowerCase(), dir.toLowerCase());
  const inside = rel === '' || (!rel.startsWith('..') && !path.win32.isAbsolute(rel));
  return !inside;
}

/**
 * Best-effort: owner + SYSTEM + Administrators full control, inheritance
 * removed (mirrors hardenWindowsSystemDir in spaces-service.js). Never throws.
 */
function hardenDataDir(dir) {
  try {
    const user = os.userInfo().username;
    if (!needsOwnerOnlyAcl(dir, os.homedir(), process.platform, user)) return;
    spawnSync('icacls', [dir, '/inheritance:r',
      '/grant:r', `${user}:(OI)(CI)F`,
      '/grant:r', '*S-1-5-18:(OI)(CI)F', // SYSTEM
      '/grant:r', '*S-1-5-32-544:(OI)(CI)F', // Administrators
    ], { stdio: 'pipe', timeout: 5000, windowsHide: true });
  } catch { /* best-effort; non-fatal */ }
}

module.exports = { needsOwnerOnlyAcl, hardenDataDir };
