#!/usr/bin/env node

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Resolve the target user's home directory.
// On Windows, if running from a separate admin account, find the user
// who actually has Claude Code data (.claude/ directory).
function resolveTargetHome() {
  const currentHome = os.homedir();
  if (process.platform !== 'win32') return currentHome;
  // Check if the current user has .claude — if so, they're the target
  if (fs.existsSync(path.join(currentHome, '.claude'))) return currentHome;
  // Scan for users with .claude
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
const SPACES_DIR = path.join(TARGET_HOME, '.spaces');
const PACKAGES_DIR = path.join(SPACES_DIR, 'packages');
const NODE_MODULES_DIR = path.join(PACKAGES_DIR, 'node_modules', '@spaces');

// ─── Package definitions ─────────────────────────────────────
const PACKAGES = {
  teams: {
    name: '@spaces/teams',
    dir: path.join(PACKAGES_DIR, 'teams'),
    repo: 'jlongo78/spaces-teams',
    private: false,
    verify: (dir) => fs.existsSync(path.join(dir, 'dist', 'index.js')),
    verifyLabel: 'dist/index.js',
  },
  pro: {
    name: '@spaces/pro',
    dir: path.join(PACKAGES_DIR, 'pro'),
    repo: 'jlongo78/spaces-pro',
    private: true,
    verify: (dir) => fs.existsSync(path.join(dir, 'dist', 'index.js')),
    verifyLabel: 'dist/index.js',
  },
  cortex: {
    name: '@spaces/cortex',
    dir: path.join(PACKAGES_DIR, 'cortex'),
    repo: 'jlongo78/spaces-cortex',
    private: true,
    verify: (dir) => fs.existsSync(path.join(dir, 'dist', 'index.js')),
    verifyLabel: 'dist/index.js',
  },
};

// ─── Helpers ──────────────────────────────────────────────────
function log(msg) { console.log(`  ${msg}`); }
function logOk(msg) { console.log(`  ✓ ${msg}`); }
function logErr(msg) { console.error(`  ✗ ${msg}`); }
function logWarn(msg) { console.log(`  ! ${msg}`); }

// On Windows, ensure Git is in PATH (admin accounts may not inherit user PATH)
function ensureGitInPath() {
  if (process.platform !== 'win32') return;
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe', shell: true });
    return; // git already available
  } catch {}
  // Try common Git install locations (system-wide and per-user)
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'cmd'),
    // Per-user installs (check target user and all profiles)
    path.join(TARGET_HOME, 'AppData', 'Local', 'Programs', 'Git', 'cmd'),
    path.join(TARGET_HOME, 'AppData', 'Local', 'Programs', 'Git', 'mingw64', 'bin'),
  ];
  // Also check all user profiles in case Git is installed by a different user
  try {
    const usersDir = path.dirname(os.homedir());
    for (const name of fs.readdirSync(usersDir)) {
      candidates.push(path.join(usersDir, name, 'AppData', 'Local', 'Programs', 'Git', 'cmd'));
      candidates.push(path.join(usersDir, name, 'AppData', 'Local', 'Programs', 'Git', 'mingw64', 'bin'));
    }
  } catch {}
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'git.exe'))) {
      process.env.PATH = process.env.PATH + ';' + dir;
      return;
    }
  }
}
ensureGitInPath();

function run(cmd, args, opts = {}) {
  const isWin = process.platform === 'win32';
  const safeArgs = isWin
    ? args.map(a => (a.includes(' ') ? '"' + a + '"' : a))
    : args;
  return execFileSync(cmd, safeArgs, {
    encoding: 'utf-8',
    stdio: opts.quiet ? ['pipe', 'pipe', 'pipe'] : 'inherit',
    shell: isWin,
    ...opts,
  });
}

// Git args prefix: allow operating on repos owned by a different user
// (e.g. admin account managing packages in the target user's home)
const GIT_SAFE = ['-c', 'safe.directory=*'];

/**
 * Clone a repo, trying SSH first then HTTPS (with optional PAT).
 */
function gitClone(repo, dest, isPrivate) {
  const sshUrl = `git@github.com:${repo}.git`;
  const httpsUrl = `https://github.com/${repo}.git`;

  // Try SSH first
  try {
    log(`Cloning ${repo} (SSH)...`);
    run('git', [...GIT_SAFE, 'clone', '--depth', '1', sshUrl, dest]);
    return;
  } catch {
    // SSH failed, try HTTPS
  }

  // HTTPS — check for PAT if private
  if (isPrivate) {
    const pat = process.env.GH_PAT || process.env.GITHUB_TOKEN || '';
    if (pat) {
      log(`Cloning ${repo} (HTTPS + token)...`);
      const authedUrl = `https://${pat}@github.com/${repo}.git`;
      run('git', [...GIT_SAFE, 'clone', '--depth', '1', authedUrl, dest]);
      return;
    }
  }

  log(`Cloning ${repo} (HTTPS)...`);
  run('git', [...GIT_SAFE, 'clone', '--depth', '1', httpsUrl, dest]);
}

/**
 * Pull latest changes in a repo directory.
 * Stashes any local modifications first so pull doesn't fail.
 */
function gitPull(dir) {
  log('Pulling latest...');
  // Stash local changes if any (e.g. hook-generated files)
  let stashed = false;
  try {
    const status = execFileSync('git', [...GIT_SAFE, 'status', '--porcelain'], { cwd: dir, encoding: 'utf-8' }).trim();
    if (status) {
      log('Stashing local changes...');
      run('git', [...GIT_SAFE, 'stash', '--include-untracked'], { cwd: dir });
      stashed = true;
    }
  } catch {}
  run('git', [...GIT_SAFE, 'pull', '--ff-only'], { cwd: dir });
  if (stashed) {
    try {
      run('git', [...GIT_SAFE, 'stash', 'pop'], { cwd: dir });
      log('Restored local changes.');
    } catch {
      log('Warning: Could not restore stashed changes. Run "git stash pop" manually in ' + dir);
    }
  }
}

/**
 * Create the symlink from node_modules/@spaces/<name> -> ../../<name>
 */
function createSymlink(pkgKey) {
  const linkPath = path.join(NODE_MODULES_DIR, pkgKey);
  const targetPath = path.join('..', '..', pkgKey); // relative symlink

  fs.mkdirSync(NODE_MODULES_DIR, { recursive: true });

  // Remove existing link/dir
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(linkPath);
    } else if (stat.isDirectory()) {
      fs.rmSync(linkPath, { recursive: true });
    }
  } catch {}

  fs.symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  logOk(`Symlink: @spaces/${pkgKey} -> packages/${pkgKey}`);
}

/**
 * Check if a native module loads correctly from a package directory.
 */
function checkNativeModule(moduleName, searchDir) {
  try {
    const nodePath = path.join(searchDir, 'node_modules');
    // Use execFileSync directly (no shell) so quotes aren't mangled on Windows
    const result = execFileSync(process.execPath, [
      '-e',
      `try { require('${moduleName}'); console.log('ok'); } catch(e) { console.log(e.message); }`,
    ], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: searchDir,
      env: { ...process.env, NODE_PATH: nodePath },
    });
    return result.trim() === 'ok';
  } catch {
    return false;
  }
}

// ─── Install command ──────────────────────────────────────────
function installPackage(pkgKey) {
  const pkg = PACKAGES[pkgKey];
  if (!pkg) {
    logErr(`Unknown package: ${pkgKey}`);
    log(`Available: ${Object.keys(PACKAGES).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n  Installing ${pkg.name}...\n`);

  // Pro requires teams as a prerequisite
  if (pkgKey === "pro") {
    const teamsDir = PACKAGES.teams.dir;
    if (!fs.existsSync(path.join(teamsDir, "dist", "index.js"))) {
      log("@spaces/pro requires @spaces/teams -- installing teams first...");
      console.log("");
      installPackage("teams");
      console.log("");
    }
  }

  // 1. Clone or pull
  if (fs.existsSync(path.join(pkg.dir, '.git'))) {
    gitPull(pkg.dir);
  } else {
    fs.mkdirSync(PACKAGES_DIR, { recursive: true });
    gitClone(pkg.repo, pkg.dir, pkg.private);
  }

  // 2. Install dependencies
  // Both teams and pro need TypeScript build
  log('Installing dependencies...');
  run('npm', ['install'], { cwd: pkg.dir });

  // Rebuild native modules for the current platform/ABI
  log('Rebuilding native modules...');
  run('npm', ['rebuild'], { cwd: pkg.dir });

  log('Building TypeScript...');
  run('npm', ['run', 'build'], { cwd: pkg.dir });

  log('Pruning dev dependencies...');
  run('npm', ['prune', '--omit=dev'], { cwd: pkg.dir });

  // 5. Create symlink
  createSymlink(pkgKey);

  // 6. Verify
  if (pkg.verify(pkg.dir)) {
    logOk(`${pkg.name} installed successfully`);
  } else {
    logErr(`${pkg.name} installed but ${pkg.verifyLabel} not found`);
    process.exit(1);
  }

  // 7. Verify native modules
  if (!checkNativeModule('better-sqlite3', pkg.dir)) {
    logWarn('better-sqlite3 native module not loading — attempting rebuild...');
    run('npm', ['rebuild', 'better-sqlite3'], { cwd: pkg.dir });
    if (checkNativeModule('better-sqlite3', pkg.dir)) {
      logOk('better-sqlite3 rebuilt successfully');
    } else {
      logErr('better-sqlite3 still failing — you may need to install build tools');
    }
  } else {
    logOk('Native modules OK');
  }

  // 8. Update tier in server.json
  const configPath = path.join(SPACES_DIR, 'server.json');
  try {
    const config = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      : { port: 3457, basePath: '' };
    // teams → team tier, pro → federation tier
    // Add-on packages set their tier; base package resets to community
    // only if no add-on package is currently installed
    const tierMap = { teams: 'team', pro: 'federation' };
    if (tierMap[pkgKey]) {
      // Installing an add-on — set its tier
      config.tier = tierMap[pkgKey];
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      logOk(`Tier set to ${tierMap[pkgKey]}`);
    } else if (!config.tier || config.tier === 'community') {
      // Base package install, no add-on tier — ensure community
      config.tier = 'community';
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      logOk(`Tier set to community`);
    } else {
      // Base package install but an add-on tier exists — preserve it
      logOk(`Tier unchanged (${config.tier})`);
    }
  } catch {}

  // 9. Verify require() works
  try {
    const result = execFileSync(process.execPath, [
      '-e',
      `const p = require.resolve('${pkg.name}'); console.log('resolved: ' + p);`,
    ], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_PATH: path.join(PACKAGES_DIR, 'node_modules') },
    });
    logOk(`require('${pkg.name}') -> ${result.trim().replace('resolved: ', '')}`);
  } catch {
    logWarn(`require('${pkg.name}') failed — this may be OK if peer deps aren't available yet`);
  }

  console.log('');
}

// ─── Verify command ───────────────────────────────────────────
function verifyAll() {
  console.log('\n  Spaces Package Verification\n');

  let allOk = true;

  for (const [key, pkg] of Object.entries(PACKAGES)) {
    log(`─── ${pkg.name} ───`);

    // Check if installed
    if (!fs.existsSync(pkg.dir)) {
      logWarn('Not installed');
      log('');
      continue;
    }

    // Check git status
    try {
      const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: pkg.dir, quiet: true }).trim();
      const hash = run('git', ['rev-parse', '--short', 'HEAD'], { cwd: pkg.dir, quiet: true }).trim();
      logOk(`Git: ${branch} @ ${hash}`);
    } catch {
      logErr('Git status check failed');
      allOk = false;
    }

    // Check entry point
    if (pkg.verify(pkg.dir)) {
      logOk(`Entry: ${pkg.verifyLabel} exists`);
    } else {
      logErr(`Entry: ${pkg.verifyLabel} missing`);
      allOk = false;
    }

    // Check node_modules
    if (fs.existsSync(path.join(pkg.dir, 'node_modules'))) {
      logOk('Dependencies: node_modules present');
    } else {
      logErr('Dependencies: node_modules missing');
      allOk = false;
    }

    // Check symlink
    const linkPath = path.join(NODE_MODULES_DIR, key);
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(linkPath);
        logOk(`Symlink: @spaces/${key} -> ${target}`);
      } else {
        logWarn(`@spaces/${key} exists but is not a symlink`);
      }
    } catch {
      logErr(`Symlink: @spaces/${key} missing`);
      allOk = false;
    }

    // Check native modules
    const nativeOk = checkNativeModule('better-sqlite3', pkg.dir);
    if (nativeOk) {
      logOk('Native: better-sqlite3 loads OK');
    } else {
      logErr('Native: better-sqlite3 failed (ABI mismatch? Run: spaces upgrade)');
      allOk = false;
    }

    // Check require() resolution
    try {
      execFileSync(process.execPath, [
        '-e',
        `require.resolve('${pkg.name}')`,
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_PATH: path.join(PACKAGES_DIR, 'node_modules') },
      });
      logOk(`require('${pkg.name}') resolves OK`);
    } catch {
      logErr(`require('${pkg.name}') fails`);
      allOk = false;
    }

    log('');
  }

  if (allOk) {
    logOk('All checks passed');
  } else {
    logErr('Some checks failed — run "spaces upgrade" to fix');
  }
  console.log('');
}

// ─── Upgrade command ──────────────────────────────────────────
function upgradePackage(pkgKey) {
  if (pkgKey) {
    // Upgrade specific package
    const pkg = PACKAGES[pkgKey];
    if (!pkg) {
      logErr(`Unknown package: ${pkgKey}`);
      process.exit(1);
    }
    if (!fs.existsSync(pkg.dir)) {
      log(`${pkg.name} not installed — running install instead`);
      installPackage(pkgKey);
      return;
    }
    console.log(`\n  Upgrading ${pkg.name}...\n`);
    doUpgrade(pkgKey, pkg);
  } else {
    // Upgrade all installed packages
    console.log('\n  Upgrading all installed packages...\n');
    for (const [key, pkg] of Object.entries(PACKAGES)) {
      if (fs.existsSync(pkg.dir)) {
        log(`─── ${pkg.name} ───`);
        doUpgrade(key, pkg);
        log('');
      }
    }
  }
  console.log('');
}

function doUpgrade(pkgKey, pkg) {
  // Pull latest
  gitPull(pkg.dir);

  run('npm', ['install'], { cwd: pkg.dir });
  run('npm', ['rebuild'], { cwd: pkg.dir });
  log('Building TypeScript...');
  run('npm', ['run', 'build'], { cwd: pkg.dir });
  run('npm', ['prune', '--omit=dev'], { cwd: pkg.dir });

  // Re-create symlink
  createSymlink(pkgKey);

  if (pkg.verify(pkg.dir)) {
    logOk(`${pkg.name} upgraded successfully`);
  } else {
    logErr(`${pkg.name} upgrade failed — ${pkg.verifyLabel} not found`);
  }
}

// ─── Uninstall command ────────────────────────────────────────
function uninstallOne(pkgKey) {
  const pkg = PACKAGES[pkgKey];

  // Remove symlink
  const linkPath = path.join(NODE_MODULES_DIR, pkgKey);
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(linkPath);
    } else if (stat.isDirectory()) {
      fs.rmSync(linkPath, { recursive: true });
    }
    logOk(`Removed symlink @spaces/${pkgKey}`);
  } catch {
    logWarn(`Symlink @spaces/${pkgKey} not found`);
  }

  // Remove package directory
  if (fs.existsSync(pkg.dir)) {
    fs.rmSync(pkg.dir, { recursive: true });
    logOk(`Removed ${pkg.dir}`);
  } else {
    logWarn(`${pkg.dir} not found`);
  }
}

function uninstallPackage(pkgKey) {
  if (pkgKey) {
    const pkg = PACKAGES[pkgKey];
    if (!pkg) {
      logErr(`Unknown package: ${pkgKey}`);
      log(`Available: ${Object.keys(PACKAGES).join(', ')}`);
      process.exit(1);
    }
    console.log(`\n  Uninstalling ${pkg.name}...\n`);
    uninstallOne(pkgKey);
    // Reset tier to community if removing a tier package
    const configPath = path.join(SPACES_DIR, 'server.json');
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.tier && config.tier !== 'community') {
          config.tier = 'community';
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          logOk('Reset tier to community');
        }
      }
    } catch {}
    logOk(`${pkg.name} uninstalled`);
  } else {
    console.log('\n  Uninstalling everything...\n');

    // Remove tier packages
    for (const [key, pkg] of Object.entries(PACKAGES)) {
      if (fs.existsSync(pkg.dir) || fs.existsSync(path.join(NODE_MODULES_DIR, key))) {
        log(`─── ${pkg.name} ───`);
        uninstallOne(key);
      }
    }
    // Clean up packages dir
    try { fs.rmdirSync(NODE_MODULES_DIR); } catch {}
    try { fs.rmdirSync(path.join(PACKAGES_DIR, 'node_modules')); } catch {}
    try { fs.rmdirSync(PACKAGES_DIR); } catch {}

    // Remove the global spaces CLI
    log('─── @jlongo78/agent-spaces ───');
    try {
      run('npm', ['uninstall', '-g', '@jlongo78/agent-spaces'], { quiet: true });
      logOk('Removed global spaces CLI');
    } catch {
      logWarn('Global spaces CLI not found or already removed');
    }

    // Reset tier to community in server.json
    const configPath = path.join(SPACES_DIR, 'server.json');
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.tier && config.tier !== 'community') {
          config.tier = 'community';
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
          logOk('Reset tier to community');
        }
      }
    } catch {}

    logOk('Spaces fully uninstalled');
    log('User data remains at ~/.spaces/ — remove manually if desired');
  }
  console.log('');
}

// ─── CLI ──────────────────────────────────────────────────────
const command = process.argv[2];
const target = process.argv[3];

switch (command) {
  case 'install':
    if (!target) {
      logErr('Usage: spaces install <teams|pro>');
      process.exit(1);
    }
    installPackage(target);
    break;

  case 'uninstall':
    uninstallPackage(target || null);
    break;

  case 'verify':
    verifyAll();
    break;

  case 'upgrade':
    upgradePackage(target || null);
    break;

  default:
    logErr(`Unknown command: ${command}`);
    log('Usage: spaces <install|uninstall|verify|upgrade> [package]');
    process.exit(1);
}
