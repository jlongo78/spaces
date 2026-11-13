#!/usr/bin/env node

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const { spacesHome } = require('./lib/spaces-home');
const fs = require('fs');

const CORE_PACKAGE = '@jlongo78/agent-spaces';

// Resolve the target user's home directory.
// On Windows, if running from a separate admin account, find the user
// who actually has Claude Code data (.claude/ directory).
function resolveTargetHome() {
  const currentHome = os.homedir();
  if (process.platform !== 'win32') return currentHome;
  if (fs.existsSync(path.join(currentHome, '.claude'))) return currentHome;
  const usersDir = path.dirname(currentHome);
  const skip = new Set(['Public', 'Default', 'Default User', 'All Users']);
  try {
    const claudeUsers = fs.readdirSync(usersDir)
      .filter(name => !skip.has(name) && !name.startsWith('.'))
      .filter(name => fs.existsSync(path.join(usersDir, name, '.claude')));
    if (claudeUsers.length === 1) return path.join(usersDir, claudeUsers[0]);
  } catch {}
  return currentHome;
}

const TARGET_HOME = resolveTargetHome();
const IS_OWN_HOME = process.platform === 'win32'
  ? path.resolve(TARGET_HOME).toLowerCase() === path.resolve(os.homedir()).toLowerCase()
  : path.resolve(TARGET_HOME) === path.resolve(os.homedir());
const SPACES_DIR = IS_OWN_HOME ? spacesHome() : path.join(TARGET_HOME, '.spaces');
if (!IS_OWN_HOME && process.env.SPACES_HOME && process.env.SPACES_HOME.trim()) {
  logWarn(`SPACES_HOME is ignored when installing for another user; using ${SPACES_DIR}`);
}

// ─── Helpers ──────────────────────────────────────────────────
function log(msg) { console.log(`  ${msg}`); }
function logOk(msg) { console.log(`  ✓ ${msg}`); }
function logErr(msg) { console.error(`  ✗ ${msg}`); }
function logWarn(msg) { console.log(`  ! ${msg}`); }

/**
 * `--prefix` for npm when this copy was installed somewhere other than
 * npm's global folder — ~/.local, where `spaces --remote` and the install
 * script put it when that folder needs root — so an upgrade replaces this
 * copy instead of failing to write the root-owned one.
 */
function samePlaceArgs() {
  const { installPrefix } = require('./lib/path-check');
  const here = installPrefix(path.join(__dirname, '..'));
  if (!here) return [];
  let globalPrefix = '';
  try { globalPrefix = String(run('npm', ['prefix', '-g'], { quiet: true })).trim(); } catch { /* use ours */ }
  const same = (a, b) => process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
  return globalPrefix && same(here, globalPrefix) ? [] : ['--prefix', here];
}

function run(cmd, args, opts = {}) {
  const options = {
    encoding: 'utf-8',
    stdio: opts.quiet ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    ...opts,
  };
  if (process.platform !== 'win32') return execFileSync(cmd, args, options);
  // npm is a .cmd on Windows, which only runs through the shell. One
  // command line rather than a list of arguments: Node warns (DEP0190)
  // about passing a list to a shell, which joins it unescaped anyway.
  const line = [cmd, ...args].map((a) => (/[\s&|<>^"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)).join(' ');
  return execFileSync(line, { ...options, shell: true });
}

function restartServiceIfRunning() {
  // Only through a registered service: `spaces service stop` kills the
  // processes on the Spaces ports, so with no service it would take down a
  // server started by hand and start nothing in its place.
  const { serviceInstalled } = require('./lib/service-registration');
  if (!serviceInstalled()) {
    log('If Spaces is running, "spaces restart" puts the new version in charge.');
    return;
  }
  const serviceScript = path.join(__dirname, 'spaces-service.js');
  try {
    log('Restarting service...');
    execFileSync(process.execPath, [serviceScript, 'stop'], { stdio: 'pipe', timeout: 10000 });
  } catch { /* may not be running */ }
  try {
    execFileSync(process.execPath, [serviceScript, 'start'], { stdio: 'inherit', timeout: 10000 });
    logOk('Service restarted with new version');
  } catch {
    log('Run "spaces service start" to start the new version');
  }
}

// ─── Upgrade ──────────────────────────────────────────────────
// Upgrade the core CLI via npm, in place.
function upgradeCorePackage() {
  log(`─── ${CORE_PACKAGE} ───`);

  let currentVersion = '0.0.0';
  try { currentVersion = require('../package.json').version; } catch {}

  let latestVersion;
  try {
    latestVersion = run('npm', ['view', CORE_PACKAGE, 'version'], { quiet: true }).trim();
  } catch {
    logErr(`Could not check npm for the latest ${CORE_PACKAGE} version`);
    return;
  }

  if (latestVersion === currentVersion) {
    logOk(`${CORE_PACKAGE} is already at the latest version (${currentVersion})`);
    return;
  }

  log(`Upgrading ${CORE_PACKAGE}: ${currentVersion} → ${latestVersion}`);
  const stopped = stopForUpdate();
  if (stopped === null) return;
  try {
    run('npm', ['install', '-g', ...samePlaceArgs(), `${CORE_PACKAGE}@latest`]);
    logOk(`${CORE_PACKAGE} upgraded to ${latestVersion}`);
  } catch (err) {
    logErr(`Failed to upgrade ${CORE_PACKAGE}: ${err.message}`);
    log('You may need to run with elevated permissions (sudo / admin shell)');
    if (stopped) startAgain();
    return;
  }

  // Clear stale update-check cache so the UI shows the correct version.
  try { fs.unlinkSync(path.join(SPACES_DIR, 'update-check.json')); } catch {}

  if (stopped) startAgain();
  else restartServiceIfRunning();
}

// ─── Updating under a running Spaces on Windows ───────────────
// Windows will not replace the files of a running program, and the server
// and every open terminal client run from this package's folder: npm's
// update fails with EBUSY. So on Windows they stop first, and the server
// starts again after, on the new version. Elsewhere files can be replaced
// in place, and nothing changes.

const LAUNCHER = path.join(__dirname, 'spaces.js');

function launcher(args, opts = {}) {
  return require('child_process').spawnSync(process.execPath, [LAUNCHER, ...args], { encoding: 'utf-8', windowsHide: true, ...opts });
}

/** Terminal clients running from this package, by pid. */
function openClients() {
  const pkg = path.join(__dirname, '..');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-Process spaces-tui -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($env:SPACES_PKG, 'OrdinalIgnoreCase') } | ForEach-Object { $_.Id }"],
    { encoding: 'utf-8', timeout: 15000, windowsHide: true, env: { ...process.env, SPACES_PKG: pkg } });
    return out.split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/**
 * Stops what would block the update. Returns true when the server was
 * running (so it should start again), false when nothing needed stopping,
 * and null when the update should not go ahead.
 */
function stopForUpdate({ platform = process.platform, uninstalling = false } = {}) {
  if (platform !== 'win32' && !uninstalling) return false;
  const status = launcher(['status', '--porcelain']).stdout || '';
  const running = /SPACES_RUNNING=1/.test(status);
  const agents = Number((status.match(/SPACES_LIVE_AGENTS=(\d+)/) || [])[1] || 0);
  const clients = platform === 'win32' ? openClients() : [];
  if (!running && !clients.length) return false;
  if (process.env.SPACES_PANE_ID) {
    logErr(`This terminal runs inside Spaces, which has to stop for the ${uninstalling ? 'uninstall' : 'update'}.`);
    log(`Run "spaces ${uninstalling ? 'uninstall' : 'upgrade'}" from a terminal outside Spaces.`);
    return null;
  }
  const parts = [];
  if (running) parts.push(agents ? `the server, with ${agents} live agent${agents === 1 ? '' : 's'}` : 'the server');
  if (clients.length) parts.push(`${clients.length} open terminal client${clients.length === 1 ? '' : 's'}`);
  log(uninstalling
    ? `Spaces is running (${parts.join(', ')}); it stops before it is removed.`
    : `Spaces is running (${parts.join(', ')}), and Windows cannot update it while it runs.`);
  if (agents) log('Stopping ends the agents; Claude Code panes resume their conversation afterwards.');
  const yes = process.argv.includes('--yes') || process.argv.includes('-y');
  if (!yes) {
    if (!require('tty').isatty(0)) {
      log(`Run "spaces ${uninstalling ? 'uninstall' : 'upgrade'} --yes" to go ahead without asking.`);
      return null;
    }
    const { ask } = require('./lib/prompt');
    const question = uninstalling ? '  Stop Spaces and uninstall it? [Y/n] ' : '  Stop Spaces, update it, and start it again? [Y/n] ';
    if (ask(question, ['y', 'n'], 'y') !== 'y') {
      log('Left as is.');
      return null;
    }
  }
  for (const pid of clients) { try { process.kill(pid); } catch { /* already gone */ } }
  if (running) {
    log('Stopping Spaces...');
    launcher(['stop']);
  }
  // The processes take a moment to let go of their files.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  return running;
}

/** Starts the server again, on whatever version is now installed. */
function startAgain() {
  log('Starting Spaces again...');
  const r = launcher(['restart'], { stdio: 'inherit' });
  if (r.status !== 0) log('Run "spaces restart" to start it.');
}

// ─── Uninstall ────────────────────────────────────────────────
function uninstall() {
  console.log(`\n  Uninstalling ${CORE_PACKAGE}...\n`);
  // A server left running would go on without its files.
  if (stopForUpdate({ uninstalling: true }) === null) return;
  try {
    // npm succeeds when the package is not installed, so a failure here is
    // a real one (on Windows, usually a Spaces process still holding files).
    run('npm', ['uninstall', '-g', ...samePlaceArgs(), CORE_PACKAGE], { quiet: true });
    logOk('Removed the global spaces CLI');
  } catch (err) {
    const why = String(err.stderr || err.message).split('\n').find((l) => /npm error .*(EBUSY|EPERM|EACCES|code)/.test(l)) || '';
    logErr(`npm uninstall -g ${CORE_PACKAGE} failed${why ? `: ${why.replace(/^npm error\s*/, '')}` : ''}`);
    log('Close every Spaces window, run "spaces stop", and try again.');
    process.exitCode = 1;
    return;
  }
  logOk('Spaces uninstalled');
  log(`User data remains at ${SPACES_DIR} — remove manually if desired`);
  console.log('');
}

// ─── CLI ──────────────────────────────────────────────────────
const command = process.argv[2];

switch (command) {
  case 'uninstall':
    uninstall();
    break;

  case 'upgrade':
    console.log('\n  Upgrading Agent Spaces...\n');
    upgradeCorePackage();
    console.log('');
    break;

  default:
    logErr(`Unknown command: ${command}`);
    log('Usage: spaces <upgrade|uninstall>');
    process.exit(1);
}
