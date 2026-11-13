// Resolves the Spaces data folder: $SPACES_HOME if set, else <home>/.spaces.
// Twin of src/lib/spaces-home.ts (src/ and bin/ never import each other) —
// keep the two in sync; tests/lib/spaces-home.test.ts pins parity. See #38.
const fs = require('fs');
const os = require('os');
const path = require('path');

function spacesHome(home) {
  const raw = (process.env.SPACES_HOME || '').trim();
  if (!raw) return path.join(home || os.homedir(), '.spaces');

  const expanded = /^~(?:[\\/]|$)/.test(raw) ? path.join(os.homedir(), raw.slice(2)) : raw;
  const resolved = path.resolve(expanded);

  let stat = null;
  try { stat = fs.statSync(resolved); } catch { /* missing is fine */ }
  if (stat && !stat.isDirectory()) {
    throw new Error(`SPACES_HOME (${resolved}) is not a folder`);
  }
  // The home folder itself would make file browsers deny all of home and
  // POSIX permission tightening chmod home to 0700.
  const homeDir = path.resolve(os.homedir());
  const same = process.platform === 'win32'
    ? resolved.toLowerCase() === homeDir.toLowerCase()
    : resolved === homeDir;
  if (same) {
    throw new Error(`SPACES_HOME (${resolved}) is your home folder; use a folder inside it instead`);
  }
  return resolved;
}

// Launchers: resolve once and, when SPACES_HOME is set, rewrite it to the
// absolute path so children started in another cwd (Next standalone, panes)
// resolve the same folder. Throws like spacesHome().
function pinSpacesHome() {
  const dir = spacesHome();
  if ((process.env.SPACES_HOME || '').trim()) process.env.SPACES_HOME = dir;
  return dir;
}

module.exports = { spacesHome, pinSpacesHome };
