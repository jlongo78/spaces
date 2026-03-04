#!/usr/bin/env node

const http = require('http');
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
// terminal-server is loaded lazily (after SPACES_TIER is set in process.env)

const SPACES_DIR = path.join(os.homedir(), '.spaces');
const CONFIG_PATH = path.join(SPACES_DIR, 'server.json');
const SESSION_SECRET_PATH = path.join(SPACES_DIR, 'session_secret');
const NEXT_INTERNAL_PORT = 3400;
const projectDir = path.join(__dirname, '..');

// ─── CLI arg parsing ──────────────────────────────────────
const args = process.argv.slice(2);
const cliFlags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--setup') { cliFlags.setup = true; }
  else if (args[i] === '--port' && args[i + 1]) { cliFlags.port = parseInt(args[++i], 10); }
  else if (args[i] === '--tier' && args[i + 1]) { cliFlags.tier = args[++i]; }
  else if (args[i] === '--base-path' && args[i + 1]) { cliFlags.basePath = args[++i]; }
  else if (args[i] === '--help' || args[i] === '-h') { cliFlags.help = true; }
}

if (cliFlags.help) {
  console.log(`
  Spaces - Agent Workspace Manager

  Usage:
    spaces                       Start the server (auto-detects tier)
    spaces install <teams|pro>   Install a tier package
    spaces verify                Verify installed packages
    spaces upgrade [teams|pro]   Upgrade installed packages
    spaces --setup               Interactive first-time setup wizard
    spaces --port 3457           Override port
    spaces --tier team           Override tier (community|server|team|federation)
    spaces --base-path /spaces   Set base path for reverse proxy
    spaces --help                Show this help
`);
  process.exit(0);
}

// ─── Route install/verify/upgrade to spaces-install.js ────
const subcommand = args[0];
if (subcommand === 'install' || subcommand === 'verify' || subcommand === 'upgrade') {
  // Re-exec with spaces-install.js, passing through all args
  const installScript = path.join(__dirname, 'spaces-install.js');
  const { status } = require('child_process').spawnSync(
    process.execPath, [installScript, ...args],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(status || 0);
}

// ─── Setup wizard ─────────────────────────────────────────
if (cliFlags.setup) {
  require('./spaces-setup');
  // spaces-setup handles its own process.exit
} else {
  startServer();
}

function startServer() {
  // ─── Load saved config ────────────────────────────────────
  let savedConfig = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { savedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  }

  // ─── Resolve settings (CLI > env > config > defaults) ─────
  const PORT = cliFlags.port
    || parseInt(process.env.SPACES_PORT || '', 10)
    || savedConfig.port
    || 3457;

  const basePath = cliFlags.basePath
    || process.env.SPACES_BASE_PATH
    || savedConfig.basePath
    || '';

  const allowedOrigins = process.env.SPACES_ALLOWED_ORIGINS
    || savedConfig.allowedOrigins
    || '';

  // ─── Resolve optional packages once ─────────────────────────
  const proPath = resolveSpacesPro();
  const teamsPath = resolveSpacesTeams();

  // Tier resolution: CLI > env > config > auto-detect
  let tier = cliFlags.tier
    || process.env.SPACES_TIER
    || savedConfig.tier
    || '';

  // Auto-detect tier from package presence
  if (!tier) {
    if (proPath) tier = 'federation';
    else if (teamsPath) tier = 'team';
    else tier = 'community';
  }

  console.log('');
  console.log('  Spaces - Agent Workspace Manager');
  console.log('  =================================');
  console.log('');
  console.log(`  Tier: ${tier}`);

  // ─── Server tier prerequisites ────────────────────────────
  const childEnv = { ...process.env };

  if (tier !== 'community') {
    // server/federation tiers require @spaces/pro
    if ((tier === 'server' || tier === 'federation') && !proPath) {
      console.error('  Error: @spaces/pro is required for server/federation tiers.');
      console.error('  Install it: spaces install pro');
      process.exit(1);
    }
    // team/federation tiers require @spaces/teams
    if ((tier === 'team' || tier === 'federation') && !teamsPath) {
      console.error('  Error: @spaces/teams is required for team/federation tiers.');
      console.error('  Install it: spaces install teams');
      process.exit(1);
    }

    // Check for session secret
    let sessionSecret = process.env.SPACES_SESSION_SECRET || '';
    if (!sessionSecret && fs.existsSync(SESSION_SECRET_PATH)) {
      sessionSecret = fs.readFileSync(SESSION_SECRET_PATH, 'utf-8').trim();
    }

    // Check for admin DB — auto-setup if missing
    const adminDbPath = path.join(SPACES_DIR, 'admin.db');
    if (!fs.existsSync(adminDbPath) || !sessionSecret) {
      const { autoSetup } = require('./lib/auto-setup');
      const result = autoSetup({ SPACES_DIR, SESSION_SECRET_PATH, ADMIN_DB_PATH: adminDbPath, CONFIG_PATH, tier, port: PORT, basePath });
      sessionSecret = result.sessionSecret;
    }

    childEnv.SPACES_SESSION_SECRET = sessionSecret;
    process.env.SPACES_SESSION_SECRET = sessionSecret;
    console.log(`  Admin DB: ${adminDbPath}`);
  }

  // Set tier in both child env and own process env (terminal-server reads it)
  childEnv.SPACES_TIER = tier;
  process.env.SPACES_TIER = tier;
  if (basePath) {
    childEnv.SPACES_BASE_PATH = basePath;
    console.log(`  Base path: ${basePath}`);
  }
  if (allowedOrigins) {
    childEnv.SPACES_ALLOWED_ORIGINS = allowedOrigins;
    process.env.SPACES_ALLOWED_ORIGINS = allowedOrigins;
    console.log(`  Allowed origins: ${allowedOrigins}`);
  }

  // ─── Resolve NODE_PATH for @spaces/pro and @spaces/teams ──
  // Update both childEnv (for the Next.js child process) and process.env
  // (for terminal-server.js which runs in this same parent process).
  // Include:
  //   - Managed packages node_modules (~/.spaces/packages/node_modules)
  //   - Each managed package's own node_modules (for its bundled deps)
  //   - The host app's own node_modules (fallback for peer deps)
  const appNodeModules = path.join(projectDir, 'node_modules');
  const nodePaths = [MANAGED_NODE_MODULES, appNodeModules];
  // Add each resolved package's own node_modules so its bundled deps are found
  for (const pkgPath of [proPath, teamsPath]) {
    if (pkgPath) {
      // pkgPath is the package root (symlink target or direct path)
      const realPath = fs.realpathSync(pkgPath);
      const pkgNodeModules = path.join(realPath, 'node_modules');
      if (fs.existsSync(pkgNodeModules) && !nodePaths.includes(pkgNodeModules)) {
        nodePaths.push(pkgNodeModules);
      }
      // Also add the parent scope for @spaces/* resolution
      const parentModules = path.dirname(path.dirname(pkgPath));
      if (!nodePaths.includes(parentModules)) {
        nodePaths.push(parentModules);
      }
    }
  }
  for (const dir of nodePaths) {
    for (const target of [childEnv, process.env]) {
      const existing = target.NODE_PATH || '';
      if (!existing.includes(dir)) {
        target.NODE_PATH = existing
          ? `${dir}${path.delimiter}${existing}`
          : dir;
      }
    }
  }
  // Re-init module paths so require() in this process picks up the new NODE_PATH
  require('module').Module._initPaths();

  // Verify collaboration pipeline works end-to-end at startup
  if (tier === 'team' || tier === 'federation') {
    try {
      const teams = require('@spaces/teams');
      console.log('  Collaboration: @spaces/teams loaded OK');
      // Smoke-test that peer deps resolve from this process
      require('better-sqlite3');
    } catch (e) {
      console.error(`  Warning: Collaboration may not work — ${e.message}`);
      console.error('  Check that NODE_PATH includes the host app node_modules.');
    }
  }

  console.log('');

  // Check for ~/.claude/ directory
  const claudeDir = path.join(os.homedir(), '.claude');
  if (!fs.existsSync(claudeDir)) {
    console.log('  Warning: ~/.claude/ not found. Have you used Claude Code yet?');
    console.log('');
  }

  // ─── Detect build type ────────────────────────────────────
  const standaloneServer = path.join(projectDir, '.next', 'standalone', 'server.js');
  const fullBuildDir = path.join(projectDir, '.next', 'BUILD_ID');
  const isStandalone = fs.existsSync(standaloneServer);
  const isFullBuild = fs.existsSync(fullBuildDir);

  if (!isStandalone && !isFullBuild) {
    console.error('  Error: No build found.');
    console.error('  Run "npm run build" first, or install via "npm install -g @jlongo78/agent-spaces".');
    process.exit(1);
  }

  // ─── Spawn Next.js ────────────────────────────────────────
  let next;
  if (isStandalone) {
    const parentNodeModules = path.join(projectDir, 'node_modules');
    const existingNodePath = childEnv.NODE_PATH || '';
    childEnv.NODE_PATH = existingNodePath
      ? `${parentNodeModules}${path.delimiter}${existingNodePath}`
      : parentNodeModules;

    next = spawn(process.execPath, [standaloneServer], {
      cwd: path.dirname(standaloneServer),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...childEnv,
        PORT: String(NEXT_INTERNAL_PORT),
        HOSTNAME: '0.0.0.0',
        NODE_ENV: 'production',
      },
    });
  } else {
    next = spawn('npx', ['next', 'start', '--port', String(NEXT_INTERNAL_PORT)], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...childEnv,
        PORT: String(NEXT_INTERNAL_PORT),
        HOSTNAME: '0.0.0.0',
        NODE_ENV: 'production',
      },
      shell: true,
    });
  }

  let nextReady = false;

  next.stdout.on('data', (data) => {
    const msg = data.toString();
    process.stdout.write(msg);
    if (!nextReady && (msg.includes('Ready') || msg.includes('started server') || msg.includes('Listening') || msg.includes('localhost'))) {
      nextReady = true;
      console.log(`\n  Ready at http://localhost:${PORT}\n`);

      const url = `http://localhost:${PORT}`;
      try {
        if (process.platform === 'win32') {
          execFileSync('cmd', ['/c', 'start', url], { stdio: 'ignore' });
        } else if (process.platform === 'darwin') {
          execFileSync('open', [url], { stdio: 'ignore' });
        } else {
          execFileSync('xdg-open', [url], { stdio: 'ignore' });
        }
      } catch {
        console.log(`  Open ${url} in your browser`);
      }
    }
  });

  next.stderr.on('data', (data) => {
    const msg = data.toString();
    if (!msg.includes('Warning')) {
      process.stderr.write(data);
    }
  });

  next.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`  [spaces] Next.js exited with code ${code}`);
    }
    cleanup();
  });

  // ─── HTTP proxy server ────────────────────────────────────
  const server = http.createServer((req, res) => {
    // WebSocket paths are handled by the 'upgrade' event, but a plain
    // HTTP request to /ws (e.g. health check) should not be proxied to
    // Next.js which would 308-redirect it due to trailingSlash.
    const urlPath = (req.url || '').split('?')[0];
    if (urlPath === '/ws' || urlPath.endsWith('/ws') || urlPath.endsWith('/ws/')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('WebSocket endpoint');
      return;
    }

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: NEXT_INTERNAL_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('Server not ready yet. Refresh in a moment.');
      }
    });
    req.pipe(proxyReq);
  });

  const { createTerminalServer } = require('./terminal-server');
  createTerminalServer(server);

  server.listen(PORT, () => {
    console.log(`  Starting server on http://localhost:${PORT}`);
    console.log('');
  });

  function cleanup() {
    next.kill();
    server.close();
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// ─── Managed packages directory ──────────────────────────────
const MANAGED_PACKAGES = path.join(SPACES_DIR, 'packages');
const MANAGED_NODE_MODULES = path.join(MANAGED_PACKAGES, 'node_modules');

// ─── @spaces/pro resolution ──────────────────────────────────
function resolveSpacesPro() {
  // 1. Managed install (~/.spaces/packages/)
  const managed = path.join(MANAGED_NODE_MODULES, '@spaces', 'pro');
  if (fs.existsSync(path.join(managed, 'dist', 'index.js'))) return managed;

  // 2. Local node_modules (npm link / optionalDep)
  try {
    return require.resolve('@spaces/pro');
  } catch {}

  // 3. Global npm prefix (legacy)
  try {
    const globalPrefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf-8' }).trim();
    const globalProPath = path.join(globalPrefix, 'lib', 'node_modules', '@spaces', 'pro');
    if (fs.existsSync(globalProPath)) return globalProPath;
    const altPath = path.join(globalPrefix, 'node_modules', '@spaces', 'pro');
    if (fs.existsSync(altPath)) return altPath;
  } catch {}

  return null;
}

// ─── @spaces/teams resolution ────────────────────────────────
function resolveSpacesTeams() {
  // 1. Managed install (~/.spaces/packages/)
  const managed = path.join(MANAGED_NODE_MODULES, '@spaces', 'teams');
  if (fs.existsSync(path.join(managed, 'index.js'))) return managed;

  // 2. Local node_modules (npm link / optionalDep)
  try {
    return require.resolve('@spaces/teams');
  } catch {}

  // 3. Global npm prefix (legacy)
  try {
    const globalPrefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf-8' }).trim();
    const globalTeamsPath = path.join(globalPrefix, 'lib', 'node_modules', '@spaces', 'teams');
    if (fs.existsSync(globalTeamsPath)) return globalTeamsPath;
    const altPath = path.join(globalPrefix, 'node_modules', '@spaces', 'teams');
    if (fs.existsSync(altPath)) return altPath;
  } catch {}

  return null;
}
