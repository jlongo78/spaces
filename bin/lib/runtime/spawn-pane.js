'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spacesHome } = require('../spaces-home');

// Shared SSH service key path — used to spawn shells as other OS users when
// no per-user key is supplied. Mirrors bin/terminal-server.js's SERVICE_KEY.
const SERVICE_KEY = path.join(spacesHome(), 'service_key');

/**
 * Agent launch table. Moved here from terminal-server.js so both the legacy
 * WebSocket path and the protocol's pane.create share one definition.
 */
const AGENTS = {
  shell:  { command: '',       resumeFlag: '',          resumeStyle: '' },
  claude: { command: 'claude', resumeFlag: '--resume',  resumeStyle: 'flag' },
  codex:  { command: 'codex',  resumeFlag: 'resume',    resumeStyle: 'subcommand' },
  gemini: { command: 'gemini', resumeFlag: '--resume',  resumeStyle: 'flag' },
  aider:  { command: 'aider',  resumeFlag: '',          resumeStyle: '' },
  forge:  { command: 'forge',  resumeFlag: '--cid',     resumeStyle: 'flag' },
  pi:     { command: 'pi',     resumeFlag: '--session', resumeStyle: 'flag' },
  custom: { command: '',       resumeFlag: '',          resumeStyle: '' },
};

/**
 * Pure: the command line to type into a fresh pane, or '' for none.
 * @param {{agentType?: string, agentSession?: string, customCommand?: string}} [opts]
 * @returns {string}
 */
/**
 * Whether this agent can resume a past session at all.
 *
 * The one place that answers this. `session.list` consults it rather than any
 * client deciding, so a Rust copy of the agent table cannot drift the first
 * time an agent gains a resume flag.
 */
function canResume(agentType) {
  const agent = AGENTS[agentType];
  return Boolean(agent && agent.command && agent.resumeFlag);
}

function buildLaunchCommand({ agentType, agentSession, customCommand } = {}) {
  if (agentType === 'custom') return customCommand || '';
  const agent = AGENTS[agentType];
  if (!agent || !agent.command) return '';
  const resumable = agent.resumeFlag && agentSession && agentSession !== 'new';
  if (!resumable) return agent.command;
  return `${agent.command} ${agent.resumeFlag} ${agentSession}`;
}

// Env allowlist for spawned PTYs — moved here from terminal-server.js's legacy
// /ws handler so pane.create's protocol path gets the exact same treatment
// instead of inheriting the full server environment. Never forward the server's
// secrets (SPACES_SESSION_SECRET, GH_PAT, NPM_TOKEN, ANTHROPIC_API_KEY, etc) —
// only identity/shell/locale/terminal basics from the server env.
const PANE_ENV_ALLOW = [
  'HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'PWD', 'OLDPWD', 'HOSTNAME',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'LC_MESSAGES', 'LC_COLLATE', 'LC_TIME',
  'LC_NUMERIC', 'LC_MONETARY', 'TZ',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
  'XDG_STATE_HOME',
  'TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'COLORTERM', 'COLUMNS', 'LINES',
  'NODE_ENV', 'NVM_DIR', 'NVM_BIN',
  // Windows basics
  'SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'COMSPEC',
  'PATHEXT', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMDATA',
];

/**
 * Build a minimal, allowlisted PTY environment plus the agent-bus wiring
 * (SPACES_PANE_ID/SPACES_API_URL) every spawned pane needs to reach the
 * server, and the prompt-suggestion flag Claude Code panes expect. Shared by
 * the legacy /ws handler and pane.create so both spawn paths treat the
 * server's secrets identically. Callers may layer additional pane-specific
 * vars (SPACES_WORKSPACE_ID, collab config, CLAUDE_CODE_GIT_BASH_PATH, etc)
 * on top of the returned object.
 *
 * @param {object} opts
 * @param {string} opts.paneId
 * @param {number|string} opts.apiPort
 * @param {object} [opts.sourceEnv] - defaults to process.env; injectable for tests.
 * @returns {object}
 */
function buildPaneEnv({ paneId, apiPort, sourceEnv = process.env } = {}) {
  const env = {};
  for (const k of PANE_ENV_ALLOW) {
    if (sourceEnv[k] !== undefined) env[k] = sourceEnv[k];
  }
  env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = 'true';
  env.SPACES_PANE_ID = paneId;
  env.SPACES_API_URL = `http://localhost:${apiPort}`;
  return env;
}

/**
 * Locate Git for Windows' bash.exe. Mirrors bin/terminal-server.js's
 * findGitBash() verbatim so this seam picks the same shell the legacy /ws
 * handler does for non-shell agent types on Windows (Claude Code and
 * friends require bash there; cmd.exe cannot run them).
 * @returns {string|null}
 */
function findGitBash() {
  const custom = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  if (custom && fs.existsSync(custom)) return custom;
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  try {
    const result = require('child_process').execSync('where bash.exe 2>nul', { encoding: 'utf-8', timeout: 3000, windowsHide: true });
    const first = result.trim().split('\n')[0].trim();
    if (first && first.toLowerCase().includes('git') && fs.existsSync(first)) return first;
  } catch { /* not found */ }
  return null;
}

/**
 * Locate the ssh binary. Mirrors bin/terminal-server.js's findSshBinary()
 * verbatim.
 * @returns {string|null}
 */
function findSshBinary() {
  if (process.platform !== 'win32') return '/usr/bin/ssh';
  const sysSSH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
  if (fs.existsSync(sysSSH)) return sysSSH;
  const gitSSH = 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe';
  if (fs.existsSync(gitSSH)) return gitSSH;
  try {
    const result = require('child_process').execSync('where ssh.exe 2>nul', { encoding: 'utf-8', timeout: 3000, windowsHide: true });
    const first = result.trim().split('\n')[0].trim();
    if (first && fs.existsSync(first)) return first;
  } catch { /* not found */ }
  return null;
}

/**
 * Resolve the platform shell + argv for a fresh pane. Mirrors
 * handleConnection's shell-selection in bin/terminal-server.js, including
 * its precedence: SSH remoting is decided FIRST (whenever `shellUser` is
 * supplied and differs from the local OS user — exactly the real code's
 * `shellUser !== processUser` check), then the Windows non-shell-agent
 * git-bash case, then plain shell.
 *
 * SSH *credential provisioning* is deliberately NOT reproduced here — the
 * real code's `ensurePerUserKey`/`authorizeShellUser` generate keypairs,
 * run `sudo`/`icacls`, and write to `~/.ssh/authorized_keys` on demand. That
 * is host-mutating credential-provisioning, a different concern from
 * "spawn a PTY and wire it to the runtime" (the same reasoning that already
 * kept the PTY_ENV_ALLOW allowlist out of this
 * seam). The caller does that provisioning exactly as today and hands this
 * function the *result* — `shellUser` and, optionally, the resolved
 * `sshKeyPath` — the same way it already hands in a pre-built `env`.
 *
 * @param {string} agentType
 * @param {{shellUser?: string, sshKeyPath?: string}} [sshOpts]
 * @returns {{shell: string, args: string[]} | {error: string}}
 */
function resolveShell(agentType, { shellUser, sshKeyPath } = {}) {
  const isWindows = process.platform === 'win32';
  const processUser = os.userInfo().username;
  const isSSH = !!shellUser && shellUser !== processUser;

  if (isSSH) {
    const sshBin = findSshBinary();
    if (!sshBin) {
      return { error: 'SSH not available. Install OpenSSH to enable multi-user terminals.' };
    }
    const sshKey = sshKeyPath || SERVICE_KEY;
    return {
      shell: sshBin,
      args: [
        '-4', // Force IPv4 — localhost may resolve to ::1 which sshd can reject
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', `UserKnownHostsFile=${path.join(spacesHome(), 'known_hosts')}`,
        '-i', sshKey,
        '-t',
        `${shellUser}@localhost`,
      ],
    };
  }
  if (isWindows && agentType !== 'shell') {
    return { shell: findGitBash() || 'cmd.exe', args: [] };
  }
  return { shell: isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/bash'), args: [] };
}

/**
 * Spawn a pane's PTY and attach it to the runtime. Deliberately knows
 * nothing about WebSockets — the legacy /ws handler and pane.create both
 * call this and then handle their own client plumbing. Does NOT write the
 * launch command to the terminal; the caller decides when (the legacy path
 * has its own timing and session-detection logic around that write).
 *
 * @param {object} opts
 * @param {string} opts.paneId
 * @param {string} opts.cwd
 * @param {string} [opts.agentType]
 * @param {number} [opts.cols]
 * @param {number} [opts.rows]
 * @param {object} [opts.env]
 * @param {object} opts.runtime - has registerPane/feed/paneExit
 * @param {string|null} [opts.workspaceId]
 * @param {string} [opts.customCommand]
 * @param {string} [opts.agentSession]
 * @param {object} [opts.ptyLib] - injectable for tests; defaults to require('node-pty')
 * @param {string} [opts.shellUser] - resolved OS shell user for this pane
 *   (the caller's `lookupShellUser(username)` result). When supplied and it
 *   differs from the local OS user, the pane is spawned over SSH as that
 *   user instead of locally — mirrors the legacy handler's `isSSH` check.
 *   Omit for a local pane; the two local branches are unaffected.
 * @param {string} [opts.sshKeyPath] - private key path to pass to `ssh -i`
 *   for an SSH-remoted pane (the caller's already-provisioned per-user key,
 *   or the shared service key). Only consulted when `shellUser` triggers
 *   SSH; defaults to the shared service key path
 *   (`~/.spaces/service_key`) when omitted, same as the legacy handler's
 *   fallback. Provisioning that key (generating it, authorizing it on the
 *   target account) remains the caller's job — this seam only spawns.
 * @returns {{ok: true, term: object, launchCommand: string} | {ok: false, error: string}}
 */
/**
 * node-pty 1.1.0 publishes its macOS `spawn-helper` without the execute bit,
 * and every spawn then fails with "posix_spawnp failed". Set it once, the
 * first time a pane starts; at run time rather than install time, so it
 * holds however the package was installed (scripts skipped included).
 */
let spawnHelperChecked = false;
function ensureSpawnHelperExecutable(fsMod = require('fs'), pathMod = require('path')) {
  if (spawnHelperChecked || process.platform === 'win32') return;
  spawnHelperChecked = true;
  let root;
  try { root = pathMod.dirname(require.resolve('node-pty/package.json')); } catch { return; }
  for (const dir of [`prebuilds/${process.platform}-${process.arch}`, 'build/Release']) {
    const helper = pathMod.join(root, dir, 'spawn-helper');
    try {
      const mode = fsMod.statSync(helper).mode;
      if ((mode & 0o111) !== 0o111) fsMod.chmodSync(helper, mode | 0o755);
    } catch { /* absent, or not ours to change: the spawn reports it */ }
  }
}

function spawnPane({
  paneId, cwd, agentType = 'shell', cols = 120, rows = 30, env,
  runtime, workspaceId = null, customCommand, agentSession, ptyLib,
  shellUser, sshKeyPath,
} = {}) {
  let term;
  try {
    if (!ptyLib) ensureSpawnHelperExecutable();
    const pty = ptyLib || require('node-pty');
    const resolved = resolveShell(agentType, { shellUser, sshKeyPath });
    if (resolved.error) return { ok: false, error: resolved.error };
    const { shell, args } = resolved;

    // Tell Claude Code where git-bash is so it doesn't fail the bash
    // detection — mirrors terminal-server.js, which sets this on the env it
    // just built, right before spawning. Copy rather than mutate the
    // caller-supplied env object.
    let spawnEnv = env || process.env;
    if (shell && shell.endsWith('bash.exe') && !(spawnEnv && spawnEnv.CLAUDE_CODE_GIT_BASH_PATH)) {
      spawnEnv = { ...spawnEnv, CLAUDE_CODE_GIT_BASH_PATH: shell };
    }

    term = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols, rows, cwd,
      env: spawnEnv,
    });
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // Runtime bookkeeping is best-effort: a runtime fault must never cost the
  // user their terminal. Same stance as the legacy path's guards.
  //
  // `term` is threaded through so registerPane's live record carries the
  // real PTY handle for BOTH callers (the legacy /ws handler and
  // pane.create) — previously only pane.create assigned it manually after
  // the fact, so any pane spawned via the legacy path had rec.term stuck at
  // null forever and pane.close/workspace.close could never actually kill
  // it.
  try {
    runtime.registerPane(paneId, {
      cols, rows, agentType, cwd, workspaceId, term,
      onInput: (d) => { try { term.write(d); } catch { /* pty gone */ } },
      onResize: (c, r) => { try { term.resize(c, r); } catch { /* pty gone */ } },
    });
  } catch { /* non-fatal */ }

  term.onData((data) => {
    try { runtime.feed(paneId, data); } catch { /* non-fatal */ }
  });
  term.onExit(({ exitCode }) => {
    try { runtime.paneExit(paneId, exitCode); } catch { /* non-fatal */ }
  });

  return { ok: true, term, launchCommand: buildLaunchCommand({ agentType, agentSession, customCommand }) };
}

// findSshBinary is exported solely so tests can compute the same expected
// ssh binary path spawnPane will resolve internally, without hard-coding a
// machine-specific location or duplicating the probing logic.
module.exports = {
  spawnPane, buildLaunchCommand, canResume, AGENTS,
  findSshBinary, buildPaneEnv, PANE_ENV_ALLOW,
};
