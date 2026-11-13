'use strict';

// `spaces tips on|off`: whether the terminal client shows a tip when it
// starts. The client reads the same file (tui/crates/spaces-tui/src/tips.rs):
// ~/.spaces/tui.json, `"tips": false` for off. It belongs to the machine the
// client runs on, so a `--remote` session follows this machine's choice.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spacesHome } = require('./spaces-home');

function prefsPath(home = os.homedir()) {
  return path.join(spacesHome(home), 'tui.json');
}

function readPrefs(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** On unless the file says off. */
function tipsEnabled(home) {
  return readPrefs(prefsPath(home)).tips !== false;
}

/** Saves the setting, keeping anything else the file holds. */
function setTips(on, home) {
  const file = prefsPath(home);
  const prefs = readPrefs(file);
  prefs.tips = Boolean(on);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(prefs, null, 2)}\n`);
}

/** The `spaces tips` command. Returns the exit code. */
function tipsCommand(arg, home) {
  if (arg === 'on' || arg === 'off') {
    setTips(arg === 'on', home);
    console.log(arg === 'on'
      ? '  Tips are on: the terminal client shows one when it starts.'
      : '  Tips are off. "spaces tips on" brings them back.');
    return 0;
  }
  if (arg === undefined) {
    console.log(`  Tips are ${tipsEnabled(home) ? 'on' : 'off'}. "spaces tips on" or "spaces tips off" to change it.`);
    return 0;
  }
  console.error(`  Unknown choice "${arg}". Use "spaces tips on" or "spaces tips off".`);
  return 2;
}

module.exports = { tipsCommand, tipsEnabled, setTips, prefsPath };
