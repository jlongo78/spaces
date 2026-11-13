'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spacesHome } = require('../../../bin/lib/spaces-home');

// Repo root: this file lives at src/lib/terminal/collaboration.js, so four
// levels up reaches the spaces/ project root where bin/ and node_modules live.
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Escape a value for safe use in a shell KEY='val' assignment. */
function shellQuote(val) {
  return "'" + String(val).replace(/'/g, "'\\''") + "'";
}

/**
 * Resolve a peer dependency that lives in the host app's node_modules.
 * Uses require.main.require() so the lookup starts from the host (e.g. spaces/).
 */
function hostRequire(mod) {
  try { return require.main.require(mod); } catch {}
  return require(mod);
}

/**
 * Look up collaboration config for a pane from the user's DB.
 * Returns { workspaceId, paneName } if collaborating, null otherwise.
 */
exports.getCollabConfig = function getCollabConfig(paneId, username) {
  try {
    // Try per-user DB first (multi-user server), then fall back to main DB
    const processOwner = os.userInfo().username;
    const isLocal = username === processOwner;
    const perUserDir = path.join(spacesHome(), 'users', username);
    const mainDir = spacesHome();
    let dbPath;
    if (!isLocal && fs.existsSync(path.join(perUserDir, 'spaces.db'))) {
      dbPath = path.join(perUserDir, 'spaces.db');
    } else {
      dbPath = path.join(mainDir, 'spaces.db');
    }
    if (!fs.existsSync(dbPath)) return null;

    const Database = hostRequire('better-sqlite3');
    const spacesDb = Database(dbPath, { readonly: true });
    const paneRow = spacesDb.prepare(`
      SELECT p.workspace_id, p.title, p.is_collaborating,
             w.collaboration as ws_collaboration
      FROM panes p
      LEFT JOIN workspaces w ON w.id = p.workspace_id
      WHERE p.id = ?
    `).get(paneId);
    spacesDb.close();

    if (!paneRow) return null;
    const isCollaborating = !!(paneRow.ws_collaboration && paneRow.is_collaborating);
    if (!isCollaborating) return null;

    return {
      workspaceId: String(paneRow.workspace_id),
      paneName: paneRow.title || paneId,
    };
  } catch (e) {
    console.error(`[collab] getCollabConfig error:`, e.message);
    return null;
  }
};

/**
 * Write agent configuration files (.mcp.json, hooks, codex config)
 * for collaboration-enabled agent panes.
 */
exports.writeAgentConfig = function writeAgentConfig(agentType, cwd, env) {
  const mcpServerPath = path.join(PACKAGE_ROOT, 'bin', 'spaces-mcp.js');

  // The MCP server runs as an isolated subprocess spawned by Claude Code.
  // It needs NODE_PATH to resolve @modelcontextprotocol/sdk, better-sqlite3, etc.
  // Include: managed packages dir, spaces' own node_modules, and inherited NODE_PATH.
  const managedNodeModules = path.join(spacesHome(), 'packages', 'node_modules');
  const spacesOwnModules = path.join(PACKAGE_ROOT, 'node_modules');
  const existingNodePath = process.env.NODE_PATH || '';
  const mcpNodePaths = [managedNodeModules, spacesOwnModules];
  if (existingNodePath) mcpNodePaths.push(existingNodePath);
  const mcpEnvVars = {
    SPACES_WORKSPACE_ID: env.SPACES_WORKSPACE_ID || '',
    SPACES_API_URL: env.SPACES_API_URL || '',
    SPACES_BASE_PATH: env.SPACES_BASE_PATH || '',
    NODE_PATH: mcpNodePaths.join(path.delimiter),
  };

  // ─── Claude: .mcp.json + hooks ─────────────────────────
  if (agentType === 'claude') {
    try {
      const mcpPath = path.join(cwd, '.mcp.json');
      const existing = fs.existsSync(mcpPath)
        ? JSON.parse(fs.readFileSync(mcpPath, 'utf8'))
        : {};
      existing.mcpServers = {
        ...existing.mcpServers,
        'spaces-bus': { command: 'node', args: [mcpServerPath], env: mcpEnvVars },
      };
      fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2));
    } catch (e) {
      console.error('[spaces] Failed to write .mcp.json:', e.message);
    }

    // Write .claude/settings.local.json so hooks auto-fire for collaboration.
    // Write env to a JSON config file so the hook works cross-platform
    // (inline KEY='val' syntax is bash-only and breaks on Windows).
    const hookPath = path.join(PACKAGE_ROOT, 'bin', 'spaces-hook.js');
    const hookEnvDir = path.join(spacesHome(), 'hook-env');
    if (!fs.existsSync(hookEnvDir)) fs.mkdirSync(hookEnvDir, { recursive: true });
    const paneId = env.SPACES_PANE_ID || '';
    if (paneId) {
      fs.writeFileSync(path.join(hookEnvDir, `${paneId}.json`), JSON.stringify({
        SPACES_PANE_ID: paneId,
        SPACES_WORKSPACE_ID: env.SPACES_WORKSPACE_ID || '',
        SPACES_PANE_NAME: env.SPACES_PANE_NAME || '',
        SPACES_API_URL: env.SPACES_API_URL || '',
        SPACES_COLLABORATING: env.SPACES_COLLABORATING || '1',
      }));
    }
    const hookCommand = `node "${hookPath}" ${paneId}`;
    const hookEntry = { type: 'command', command: hookCommand, timeout: 10000 };
    const hooksConfig = {
      hooks: {
        SessionStart: [{ hooks: [hookEntry] }],
        UserPromptSubmit: [{ hooks: [hookEntry] }],
        Stop: [{ hooks: [hookEntry] }],
      },
    };

    try {
      const claudeDir = path.join(cwd, '.claude');
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      const settingsPath = path.join(claudeDir, 'settings.local.json');
      const existingSettings = fs.existsSync(settingsPath)
        ? JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
        : {};
      if (existingSettings.hooks) {
        for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
          const existing = existingSettings.hooks[event] || [];
          const alreadyConfigured = existing.some(m =>
            m.hooks && m.hooks.some(h => h.command && h.command.includes('spaces-hook.js'))
          );
          if (!alreadyConfigured) {
            existingSettings.hooks[event] = [...existing, ...hooksConfig.hooks[event]];
          }
        }
      } else {
        existingSettings.hooks = hooksConfig.hooks;
      }
      fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2));
    } catch (e) {
      console.error('[spaces] Failed to write .claude/settings.local.json:', e.message);
    }
  }

  // ─── Codex: .codex/config.toml with MCP server ─────────
  if (agentType === 'codex') {
    try {
      const codexDir = path.join(cwd, '.codex');
      if (!fs.existsSync(codexDir)) {
        fs.mkdirSync(codexDir, { recursive: true });
      }
      const configPath = path.join(codexDir, 'config.toml');

      // Build the TOML block for our MCP server
      const tomlBlock = [
        '',
        '# Spaces workspace bus (auto-configured)',
        '[mcp_servers.spaces-bus]',
        `command = "node"`,
        `args = [${JSON.stringify(mcpServerPath)}]`,
        '',
        '[mcp_servers.spaces-bus.env]',
        ...Object.entries(mcpEnvVars).map(([k, v]) => `${k} = ${JSON.stringify(v)}`),
      ].join('\n');

      // Merge into existing config if present
      if (fs.existsSync(configPath)) {
        const existing = fs.readFileSync(configPath, 'utf8');
        if (!existing.includes('[mcp_servers.spaces-bus]')) {
          fs.writeFileSync(configPath, existing + '\n' + tomlBlock + '\n');
        }
      } else {
        fs.writeFileSync(configPath, tomlBlock + '\n');
      }
    } catch (e) {
      console.error('[spaces] Failed to write .codex/config.toml:', e.message);
    }
  }

  // Ensure generated config files are gitignored so they don't pollute
  // the customer's repo with untracked Spaces-specific files.
  ensureGitignore(cwd, ['.mcp.json', '.codex/']);
};

/**
 * Append entries to .gitignore if the cwd is a git repo and they're not
 * already listed. Creates .gitignore if it doesn't exist.
 */
function ensureGitignore(cwd, entries) {
  try {
    // Only act if this is a git repo
    if (!fs.existsSync(path.join(cwd, '.git'))) return;

    const gitignorePath = path.join(cwd, '.gitignore');
    const existing = fs.existsSync(gitignorePath)
      ? fs.readFileSync(gitignorePath, 'utf8')
      : '';
    const lines = existing.split('\n');
    const toAdd = entries.filter(e => !lines.some(l => l.trim() === e));
    if (toAdd.length === 0) return;

    const suffix = (existing && !existing.endsWith('\n') ? '\n' : '')
      + '# Spaces collaboration (auto-generated)\n'
      + toAdd.join('\n') + '\n';
    fs.appendFileSync(gitignorePath, suffix);
  } catch { /* best-effort */ }
}

/**
 * Remove agent collaboration config files written by writeAgentConfig().
 */
exports.removeAgentConfig = function removeAgentConfig(agentType, cwd) {
  // ─── Claude: .mcp.json + hooks ─────────────────────────
  if (agentType === 'claude') {
    try {
      const mcpPath = path.join(cwd, '.mcp.json');
      if (fs.existsSync(mcpPath)) {
        const existing = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
        if (existing.mcpServers) {
          delete existing.mcpServers['spaces-bus'];
          if (Object.keys(existing.mcpServers).length === 0) delete existing.mcpServers;
        }
        // Remove file if nothing meaningful remains
        if (!existing.mcpServers || Object.keys(existing).length === 0) {
          fs.unlinkSync(mcpPath);
        } else {
          fs.writeFileSync(mcpPath, JSON.stringify(existing, null, 2));
        }
      }
    } catch (e) {
      console.error('[spaces] Failed to clean .mcp.json:', e.message);
    }

    try {
      const settingsPath = path.join(cwd, '.claude', 'settings.local.json');
      if (fs.existsSync(settingsPath)) {
        const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (existing.hooks) {
          for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
            if (Array.isArray(existing.hooks[event])) {
              existing.hooks[event] = existing.hooks[event].filter(m =>
                !(m.hooks && m.hooks.some(h => h.command && h.command.includes('spaces-hook.js')))
              );
              if (existing.hooks[event].length === 0) delete existing.hooks[event];
            }
          }
          if (Object.keys(existing.hooks).length === 0) delete existing.hooks;
        }
        if (Object.keys(existing).length === 0) {
          fs.unlinkSync(settingsPath);
        } else {
          fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
        }
      }
    } catch (e) {
      console.error('[spaces] Failed to clean .claude/settings.local.json:', e.message);
    }
  }

  // ─── Codex: .codex/config.toml ─────────────────────────
  if (agentType === 'codex') {
    try {
      const configPath = path.join(cwd, '.codex', 'config.toml');
      if (fs.existsSync(configPath)) {
        let content = fs.readFileSync(configPath, 'utf8');
        // Remove the spaces-bus MCP server block
        content = content.replace(
          /\n?# Spaces workspace bus \(auto-configured\)\n\[mcp_servers\.spaces-bus\][\s\S]*?(?=\n\[|$)/,
          ''
        );
        const trimmed = content.trim();
        if (!trimmed) {
          fs.unlinkSync(configPath);
        } else {
          fs.writeFileSync(configPath, trimmed + '\n');
        }
      }
    } catch (e) {
      console.error('[spaces] Failed to clean .codex/config.toml:', e.message);
    }
  }
};

/**
 * Start the 5s polling idle nudge loop for agent collaboration.
 */
exports.startMessageWatcher = function startMessageWatcher(apiPort, sessions) {
  const apiBase = `http://127.0.0.1:${apiPort}`;
  const lastCheckedPerWorkspace = new Map();
  // SECURITY (review S3): use the dedicated internal token, not a 16-char slice
  // of the session-signing secret. The truncated value never matched the
  // server's SPACES_INTERNAL_TOKEN (so the watcher silently failed auth), and
  // deriving one secret from another conflates the cookie-signing key with the
  // internal token.
  const internalToken = process.env.SPACES_INTERNAL_TOKEN || '';

  function apiGet(urlPath) {
    return new Promise((resolve) => {
      const opts = {
        hostname: '127.0.0.1',
        port: apiPort,
        path: urlPath,
        headers: {},
      };
      if (internalToken) opts.headers['x-spaces-internal'] = internalToken;
      http.get(opts, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  }

  const COLLAB_AGENTS = new Set(['claude', 'codex']);

  async function poll() {
    const byWorkspace = new Map();
    for (const [pid, sess] of sessions) {
      if (!COLLAB_AGENTS.has(sess.agentType) || sess.exited || !sess.workspaceId || !sess.isCollaborating) continue;
      if (!byWorkspace.has(sess.workspaceId)) byWorkspace.set(sess.workspaceId, []);
      byWorkspace.get(sess.workspaceId).push({ pid, sess });
    }
    if (byWorkspace.size === 0) return;

    for (const [wsId, paneSessions] of byWorkspace) {
      const lastChecked = lastCheckedPerWorkspace.get(wsId) || new Date(Date.now() - 30000).toISOString();
      const sp = new URLSearchParams({ since: lastChecked, limit: '20' });
      const messages = await apiGet(`/api/workspaces/${wsId}/messages/?${sp}`);
      lastCheckedPerWorkspace.set(wsId, new Date().toISOString());

      if (!Array.isArray(messages) || messages.length === 0) continue;

      for (const msg of messages) {
        if (msg.status !== 'delivered' && msg.status !== 'approved') continue;

        let targetName = null;
        try {
          const meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {});
          targetName = meta.targetName || null;
        } catch { /* ignore */ }

        if (!msg.targetPaneId && !targetName) continue;

        for (const { pid, sess } of paneSessions) {
          if (pid === msg.paneId) continue;

          const nameMatch = targetName && sess.paneName === targetName;
          const idMatch = msg.targetPaneId && pid === msg.targetPaneId;
          if (!nameMatch && !idMatch) continue;

          const now = Date.now();
          const idleFor = now - sess.lastOutputTime;
          const upFor = now - sess.startedAt;
          if (upFor < 15000) continue;
          if (now - sess.lastNudgeTime < 10000) continue;
          if (idleFor < 5000) continue;

          console.log(`[MessageWatcher] Nudging pane ${pid.slice(0, 8)} (${sess.paneName}) — message from ${msg.senderName}`);
          const nudgeText = 'Check the workspace message bus - a new message arrived for you.';
          sess.pty.write(nudgeText);
          setTimeout(() => { sess.pty.write('\r'); }, 100);
          sess.lastNudgeTime = now;
          break;
        }
      }
    }
  }

  setTimeout(() => {
    console.log('[MessageWatcher] Started polling');
    poll().catch(() => {});
    setInterval(() => { poll().catch(() => {}); }, 5000);
  }, 10000);
};
