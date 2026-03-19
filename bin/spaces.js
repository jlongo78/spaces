#!/usr/bin/env node

// Re-exec with higher heap if needed (embedding models + LanceDB leak memory over time)
if (!process.execArgv.some(a => a.includes('max-old-space-size')) && !process.env.__SPACES_HEAP) {
  process.env.__SPACES_HEAP = '1';
  require('child_process').spawn(
    process.execPath,
    ['--max-old-space-size=8192', ...process.argv.slice(1)],
    { stdio: 'inherit', env: process.env }
  ).on('exit', (code) => process.exit(code ?? 1));
  // Stop the outer process from continuing
  return;
}

const net = require('net');
const http = require('http');
const https = require('https');
const { execFileSync, spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
// terminal-server is loaded lazily (after SPACES_TIER is set in process.env)

// ─── Memory monitoring (only when SPACES_DEBUG or cortex.debug) ──
let _lastHeapMB = 0;
function logMemory(label) {
  if (!process.env.SPACES_DEBUG && !_spacesDebug) return;
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1048576);
  const rssMB = Math.round(mem.rss / 1048576);
  const extMB = Math.round((mem.external || 0) / 1048576);
  const abMB = Math.round((mem.arrayBuffers || 0) / 1048576);
  const delta = heapMB - _lastHeapMB;
  if (label || Math.abs(delta) > 20) {
    console.log(`[Memory] ${label || 'periodic'}: heap=${heapMB}MB rss=${rssMB}MB external=${extMB}MB arrayBuffers=${abMB}MB ${delta > 0 ? '+' : ''}${delta}MB`);
  }
  _lastHeapMB = heapMB;
}
let _spacesDebug = false;
try {
  const cfgPath = path.join(os.homedir(), '.spaces', 'config.json');
  if (fs.existsSync(cfgPath)) _spacesDebug = !!JSON.parse(fs.readFileSync(cfgPath, 'utf-8')).cortex?.debug;
} catch { /* ignore */ }
setInterval(() => logMemory(), 60000);

const SPACES_DIR = path.join(os.homedir(), '.spaces');
const CONFIG_PATH = path.join(SPACES_DIR, 'server.json');
const SESSION_SECRET_PATH = path.join(SPACES_DIR, 'session_secret');
const NEXT_INTERNAL_PORT = 3400;
const projectDir = path.join(__dirname, '..');
const MANAGED_PACKAGES = path.join(SPACES_DIR, 'packages');
const MANAGED_NODE_MODULES = path.join(MANAGED_PACKAGES, 'node_modules');

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
    spaces stop                  Stop running server
    spaces install <teams|pro>   Install a tier package
    spaces uninstall [teams|pro] Uninstall packages (all if none specified)
    spaces verify                Verify installed packages
    spaces upgrade [teams|pro]   Upgrade installed packages
    spaces --setup               Interactive first-time setup wizard
    spaces --port 3457           Override port
    spaces --tier team           Override tier (community|team|federation)
    spaces --base-path /spaces   Set base path for reverse proxy
    spaces service install       Install as OS service (systemd/launchd/Task Scheduler)
    spaces service uninstall     Remove OS service
    spaces service start         Start the service
    spaces service stop          Stop the service
    spaces service status        Show service status
    spaces service logs          Tail service logs
    spaces reset-totp <user>     Reset TOTP/2FA for a user
    spaces --help                Show this help
`);
  process.exit(0);
}

// ─── Stop command ─────────────────────────────────────────
const subcommand = args[0];
if (subcommand === 'stop') {
  stopServer();
  process.exit(0);
}

// ─── Route install/verify/upgrade to spaces-install.js ────
if (subcommand === 'install' || subcommand === 'uninstall' || subcommand === 'verify' || subcommand === 'upgrade') {
  // Re-exec with spaces-install.js, passing through all args
  const installScript = path.join(__dirname, 'spaces-install.js');
  const { status } = require('child_process').spawnSync(
    process.execPath, [installScript, ...args],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(status || 0);
}

// ─── Route reset-totp to spaces-reset-totp.js ───────
if (subcommand === 'reset-totp') {
  const resetScript = path.join(__dirname, 'spaces-reset-totp.js');
  const { status } = require('child_process').spawnSync(
    process.execPath, [resetScript, ...args.slice(1)],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(status || 0);
}

// ─── Route service commands to spaces-service.js ─────
if (subcommand === 'service') {
  const serviceScript = path.join(__dirname, 'spaces-service.js');
  const { status } = require('child_process').spawnSync(
    process.execPath, [serviceScript, ...args.slice(1)],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(status || 0);
}

// ─── Setup wizard ─────────────────────────────────────────
if (cliFlags.setup) {
  require('./spaces-setup');
  // spaces-setup handles its own process.exit
} else if (subcommand && !subcommand.startsWith('-')) {
  console.error(`  Unknown command: ${subcommand}`);
  console.error(`  Run "spaces --help" for usage`);
  process.exit(1);
} else {
  startServer();
}

// ─── TLS certificate ────────────────────────────────────────
// Uses a real cert if configured in server.json (tlsCert, tlsKey, optional
// tlsCa for the full chain), otherwise generates a self-signed cert so
// mobile browsers that force HTTPS-first can still connect.
function ensureTlsCert() {
  // Check for configured real cert in server.json
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (config.tlsCert && config.tlsKey) {
      if (fs.existsSync(config.tlsCert) && fs.existsSync(config.tlsKey)) {
        // Read cert + key, and optionally the CA bundle for full chain
        const certPem = fs.readFileSync(config.tlsCert, 'utf-8').trim();
        const caPem = (config.tlsCa && fs.existsSync(config.tlsCa))
          ? fs.readFileSync(config.tlsCa, 'utf-8').trim()
          : null;
        const creds = {
          cert: caPem ? certPem + '\n' + caPem : certPem,
          key: fs.readFileSync(config.tlsKey, 'utf-8'),
        };
        console.log('  Using TLS certificate: ' + config.tlsCert);
        return creds;
      }
      console.log('  Warning: tlsCert/tlsKey configured but files not found, falling back to self-signed');
    }
  } catch {}

  // Fall back to self-signed
  const certPath = path.join(SPACES_DIR, 'tls-cert.pem');
  const keyPath  = path.join(SPACES_DIR, 'tls-key.pem');

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    } catch {}
  }

  try {
    fs.mkdirSync(SPACES_DIR, { recursive: true });
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048',
      '-keyout', keyPath, '-out', certPath,
      '-sha256', '-days', '365', '-nodes',
      '-subj', '/CN=spaces-local',
      '-addext', 'subjectAltName=DNS:localhost,DNS:*.local,DNS:*.robindale.com,IP:127.0.0.1',
    ], { stdio: 'pipe', timeout: 15000 });
    console.log('  Generated self-signed TLS certificate');
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  } catch (e) {
    console.log(`  Warning: Could not generate TLS cert (${e.message})`);
    console.log('  HTTPS will not be available. Install OpenSSL to enable it.');
    return null;
  }
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

  // ─── Kill any existing server on this port ───────────────────
  stopServer();

  // ─── Resolve optional packages once ─────────────────────────
  const proPath = resolveSpacesPro();
  const teamsPath = resolveSpacesTeams();
  const cortexPath = resolveSpacesCortex();

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
    // team/federation tiers require @spaces/teams (auth + collaboration)
    if ((tier === 'team' || tier === 'federation') && !teamsPath) {
      console.error('  Error: @spaces/teams is required for team/federation tiers.');
      console.error('  Install it: spaces install teams');
      process.exit(1);
    }
    // federation tier requires @spaces/pro (network)
    if (tier === 'federation' && !proPath) {
      console.error('  Error: @spaces/pro is required for the federation tier.');
      console.error('  Install it: spaces install pro');
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
  for (const pkgPath of [proPath, teamsPath, cortexPath]) {
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

  // ─── Detect @spaces/cortex ──────────────────────────────────
  if (cortexPath) {
    childEnv.SPACES_HAS_CORTEX = '1';
    process.env.SPACES_HAS_CORTEX = '1';
    console.log('  Cortex: @spaces/cortex detected');
  }

  console.log('');

  // ─── Background update check (non-blocking) ───────────────
  // Compare installed version against npm registry. Writes result to
  // ~/.spaces/update-check.json so the UI can show a banner.
  const updateCheckPath = path.join(SPACES_DIR, 'update-check.json');
  (async () => {
    try {
      const pkg = require(path.join(projectDir, 'package.json'));
      const currentVersion = pkg.version;
      const npmName = pkg.name || '@jlongo78/agent-spaces';

      // Skip if checked within the last hour
      try {
        if (fs.existsSync(updateCheckPath)) {
          const cached = JSON.parse(fs.readFileSync(updateCheckPath, 'utf-8'));
          if (Date.now() - (cached.checkedAt || 0) < 3600_000) {
            if (cached.available) {
              console.log(`  Update available: ${currentVersion} → ${cached.latest} (run: npm i -g ${npmName})`);
            }
            return;
          }
        }
      } catch { /* check fresh */ }

      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(npmName)}/latest`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const data = await res.json();
      const latest = data.version;

      const result = {
        current: currentVersion,
        latest,
        available: latest !== currentVersion && latest > currentVersion,
        checkedAt: Date.now(),
        name: npmName,
      };

      fs.writeFileSync(updateCheckPath, JSON.stringify(result, null, 2));

      if (result.available) {
        console.log(`  Update available: ${currentVersion} → ${latest} (run: npm i -g ${npmName})`);
      }
    } catch { /* network error — skip silently */ }
  })();

  // Also check addon updates (git-based packages)
  const gitSafe = ['-c', 'safe.directory=*'];
  const addonPaths = { teams: teamsPath, pro: proPath, cortex: cortexPath };
  (async () => {
    for (const [key, addonDir] of Object.entries(addonPaths)) {
      if (!addonDir || !fs.existsSync(path.join(addonDir, '.git'))) continue;
      const realDir = fs.realpathSync(addonDir);
      try {
        execFileSync('git', [...gitSafe, 'fetch', '--quiet'], { cwd: realDir, stdio: 'ignore', timeout: 5000 });
        const local = execFileSync('git', [...gitSafe, 'rev-parse', 'HEAD'], { cwd: realDir, encoding: 'utf-8' }).trim();
        const remote = execFileSync('git', [...gitSafe, 'rev-parse', '@{u}'], { cwd: realDir, encoding: 'utf-8' }).trim();
        if (local !== remote) {
          console.log(`  Update available for @spaces/${key} (run: spaces upgrade ${key})`);
        }
      } catch { /* not on a branch with upstream, skip */ }
    }
  })();

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
      console.log(`\n  Ready at http://localhost:${PORT}`);
      if (tlsCreds) console.log(`  Also at  https://localhost:${PORT}  (self-signed)`);
      console.log('');

      const url = `http://localhost:${PORT}`;
      const isService = process.env.SPACES_SERVICE === '1';
      if (!isService) {
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

  // ─── Proxy request handler (shared by HTTP and HTTPS) ────
  function proxyHandler(req, res) {
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
  }

  // ─── HTTP + HTTPS on a single port ─────────────────────────
  // Peek at the first byte of each connection: 0x16 = TLS ClientHello,
  // anything else = plain HTTP.  This lets mobile browsers that force
  // HTTPS-first connect to the same port without a separate listener.
  const httpServer = http.createServer(proxyHandler);
  const tlsCreds = ensureTlsCert();
  const httpsServer = tlsCreds ? https.createServer(tlsCreds, proxyHandler) : null;

  const { createTerminalServer } = require('./terminal-server');
  createTerminalServer(httpServer);
  if (httpsServer) createTerminalServer(httpsServer);

  // Wire up 'address()' on the inner servers so terminal-server can
  // discover the port, then emit 'listening' so its event handler fires.
  const patchAddress = (srv) => { srv.address = () => ({ port: PORT }); };
  patchAddress(httpServer);
  if (httpsServer) patchAddress(httpsServer);

  const dualServer = net.createServer((socket) => {
    // If client connects but sends nothing for 5s, destroy.
    // Once routed, clear the timeout so long-lived connections (WebSocket) aren't killed.
    socket.setTimeout(5000, () => socket.destroy());
    socket.once('data', (buf) => {
      socket.setTimeout(0);
      socket.pause();
      const target = (buf[0] === 0x16 && httpsServer) ? httpsServer : httpServer;
      target.emit('connection', socket);
      socket.unshift(buf);
      socket.resume();
    });
  });

  dualServer.listen(PORT, () => {
    // Now that the port is bound, tell the inner servers they're "listening"
    // so terminal-server's mDNS and message watcher start up.
    httpServer.emit('listening');
    if (httpsServer) httpsServer.emit('listening');

    if (httpsServer) {
      console.log(`  Starting server on port ${PORT}  (HTTP + HTTPS)`);
    } else {
      console.log(`  Starting server on http://localhost:${PORT}`);
    }
    console.log('');
  });

  function cleanup() {
    next.kill();
    dualServer.close();
    process.exit(0);
  }

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

// ─── Stop running server ─────────────────────────────────────
function findPidsOnPort(port) {
  const pids = new Set();
  if (process.platform === 'win32') {
    try {
      const output = execFileSync('netstat', ['-ano'], { encoding: 'utf-8' });
      for (const line of output.split(String.fromCharCode(10))) {
        if (line.includes(':' + port + ' ') && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (pid > 0) pids.add(pid);
        }
      }
    } catch {}
  } else {
    try {
      const output = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf-8' }).trim();
      for (const p of output.split('\n')) { if (p.trim()) pids.add(parseInt(p.trim(), 10)); }
    } catch {}
    try {
      const output = execFileSync('fuser', [`${port}/tcp`], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      for (const p of output.split(/\s+/)) { if (p.trim()) pids.add(parseInt(p.trim(), 10)); }
    } catch {}
  }
  return [...pids].filter(p => !isNaN(p) && p > 0);
}

function stopServer() {
  let savedConfig = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { savedConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  }
  const port = parseInt(process.env.SPACES_PORT || '', 10) || savedConfig.port || 3457;
  const ports = [port, NEXT_INTERNAL_PORT];
  let killed = 0;

  for (const p of ports) {
    for (const pid of findPidsOnPort(p)) {
      try {
        process.kill(pid, 'SIGTERM');
        killed++;
      } catch {}
    }
  }

  if (killed > 0) {
    console.log(`  Stopped ${killed} process(es) on port ${port}`);
    // Wait for ports to be released, escalate to SIGKILL if needed
    const deadline = Date.now() + 2000;
    let escalated = false;
    while (Date.now() < deadline) {
      const remaining = ports.flatMap(p => findPidsOnPort(p));
      if (remaining.length === 0) break;
      if (!escalated && Date.now() > deadline - 1000) {
        for (const pid of remaining) {
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }
        escalated = true;
      }
      if (process.platform === 'win32') { require('child_process').spawnSync('powershell', ['-Command', 'Start-Sleep -Milliseconds 200']); } else { require('child_process').spawnSync('sleep', ['0.2']); }
    }
  } else {
    console.log(`  No running server found on port ${port}`);
  }
}

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
  if (fs.existsSync(path.join(managed, 'dist', 'index.js'))) return managed;

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

// ─── @spaces/cortex resolution ───────────────────────────────
function resolveSpacesCortex() {
  const managed = path.join(MANAGED_NODE_MODULES, '@spaces', 'cortex');
  if (fs.existsSync(path.join(managed, 'dist', 'index.js'))) return managed;
  try { return require.resolve('@spaces/cortex'); } catch {}
  try {
    const globalPrefix = execFileSync('npm', ['prefix', '-g'], { encoding: 'utf-8' }).trim();
    const globalPath = path.join(globalPrefix, 'lib', 'node_modules', '@spaces', 'cortex');
    if (fs.existsSync(globalPath)) return globalPath;
    const altPath = path.join(globalPrefix, 'node_modules', '@spaces', 'cortex');
    if (fs.existsSync(altPath)) return altPath;
  } catch {}
  return null;
}
