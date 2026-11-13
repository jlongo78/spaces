'use strict';
// Quoting helpers for writing environment variables into background-service
// definitions (systemd unit, launchd plist, Windows wrapper .cmd).

// systemd: quote the whole assignment; escape \ and "; double % (specifier).
function systemdEnv(name, value) {
  const v = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%');
  return `Environment="${name}=${v}"`;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// launchd: <key>/<string> pair, indented like the plist's other entries.
function plistEnv(name, value) {
  return [`      <key>${xmlEscape(name)}</key>`, `      <string>${xmlEscape(value)}</string>`];
}

// cmd.exe: quote the assignment; double % so it is not expanded in a batch file.
function cmdSet(name, value) {
  return `set "${name}=${String(value).replace(/%/g, '%%')}"`;
}

module.exports = { systemdEnv, plistEnv, cmdSet };
