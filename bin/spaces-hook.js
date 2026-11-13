#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spacesHome } = require('./lib/spaces-home');

// Hooks must never break the agent: a bad SPACES_HOME means exit quietly.
let HOME_DIR;
try {
  HOME_DIR = spacesHome();
} catch {
  process.exit(0);
}

// Load env from config file if a paneId arg is provided (cross-platform)
const paneIdArg = process.argv[2];
if (paneIdArg && !process.env.SPACES_PANE_ID) {
  try {
    const envFile = path.join(HOME_DIR, 'hook-env', `${paneIdArg}.json`);
    const envData = JSON.parse(fs.readFileSync(envFile, 'utf-8'));
    for (const [k, v] of Object.entries(envData)) {
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* config file missing — fall through to env vars */ }
}

const PANE_ID = process.env.SPACES_PANE_ID || paneIdArg;
const WORKSPACE_ID = process.env.SPACES_WORKSPACE_ID;
const API_URL = process.env.SPACES_API_URL || 'http://localhost:3457';
// The server answers only its owner (see lib/desktop-auth.js). This runs as
// the owner, so it can sign a short-lived token with the owner's secret; the
// secret itself never goes on the wire, and nothing goes off this machine.
const authHeaders = () => require('./lib/desktop-auth').clientAuthHeaders(API_URL);
const PANE_NAME = process.env.SPACES_PANE_NAME || 'Claude';
const BASE_PATH = process.env.SPACES_BASE_PATH || '';

const STATE_DIR = path.join(HOME_DIR, 'hook-state');
const STATE_FILE = PANE_ID ? path.join(STATE_DIR, `${PANE_ID}.json`) : null;

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_URL}${BASE_PATH}${apiPath}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function readState() {
  try {
    if (STATE_FILE && fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return { lastChecked: new Date(0).toISOString(), consecutiveBlocks: 0 };
}

function writeState(state) {
  try {
    if (!STATE_FILE) return;
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch { /* ignore */ }
}

function formatMessages(messages) {
  return messages.map(m => {
    const time = new Date(m.created).toLocaleTimeString();
    const target = m.metadata ? (() => {
      try {
        const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
        return meta.targetName ? ` (to ${meta.targetName})` : '';
      } catch { return ''; }
    })() : '';
    return `[${time}] ${m.senderName}${target}: ${m.content}`;
  }).join('\n');
}

function isForMe(msg) {
  // Exclude own messages
  if (msg.paneId === PANE_ID) return false;
  // Only delivered or approved
  if (msg.status !== 'delivered' && msg.status !== 'approved') return false;
  // Targeted at this pane by ID
  if (msg.targetPaneId === PANE_ID) return true;
  // Targeted at this pane by name
  try {
    const meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {});
    if (meta.targetName && meta.targetName === PANE_NAME) return true;
  } catch { /* ignore */ }
  // Broadcast (no target)
  if (!msg.targetPaneId) {
    try {
      const meta = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : (msg.metadata || {});
      if (!meta.targetName) return true;
    } catch { return true; }
  }
  return false;
}

async function fetchMessagesSince(since) {
  const sp = new URLSearchParams();
  sp.set('since', since);
  sp.set('limit', '20');
  const messages = await apiRequest('GET', `/api/workspaces/${WORKSPACE_ID}/messages/?${sp}`);
  if (!Array.isArray(messages)) return [];
  return messages.filter(isForMe);
}

// ── SessionStart ──────────────────────────────────────────

async function handleSessionStart() {
  writeState({ lastChecked: new Date().toISOString(), consecutiveBlocks: 0 });

  const [panes, context] = await Promise.all([
    apiRequest('GET', `/api/panes/`).catch(() => []),
    apiRequest('GET', `/api/workspaces/${WORKSPACE_ID}/context/`).catch(() => []),
  ]);

  const otherAgents = Array.isArray(panes)
    ? panes.filter(p => p.id !== PANE_ID).map(p => `${p.title} [${p.agentType || 'shell'}]`).join(', ')
    : 'unknown';

  let prompt = `You are "${PANE_NAME}" in a multi-agent workspace.`;
  if (otherAgents) prompt += ` Other agents: ${otherAgents}.`;
  prompt += '\n\nCollaboration tools available via the spaces-bus MCP server:';
  prompt += '\n- post_message: Send messages to other agents (use target_pane_name to direct to a specific agent)';
  prompt += '\n- read_messages: Check for recent workspace messages';
  prompt += '\n- set_context: Share key information with all agents (e.g. current task, findings, decisions, file paths)';
  prompt += '\n- get_context: Read shared context from other agents';
  prompt += '\n\nWorkflow:';
  prompt += '\n- When you start a task, use set_context to share what you\'re working on (key: your name + "/task")';
  prompt += '\n- When you discover important information, use set_context to share it (e.g. key: "api-endpoints", "db-schema", "security-findings")';
  prompt += '\n- Check read_messages when completing tasks for any incoming requests';
  prompt += '\n- When you receive workspace messages (injected as context), read and respond using post_message';

  if (Array.isArray(context) && context.length > 0) {
    prompt += '\n\nShared workspace context:';
    for (const entry of context) {
      prompt += `\n  ${entry.key} = ${entry.value}`;
    }
  }

  output({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: prompt,
    },
  });
}

// ── UserPromptSubmit ─────────────────────────────────────

async function handleUserPromptSubmit() {
  const state = readState();
  const messages = await fetchMessagesSince(state.lastChecked);
  writeState({ ...state, lastChecked: new Date().toISOString() });

  if (messages.length === 0) return;

  const formatted = formatMessages(messages);
  output({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `Workspace messages received:\n\n${formatted}\n\nRespond to these using post_message if appropriate.`,
    },
  });
}

// ── Stop ─────────────────────────────────────────────────

async function handleStop(hookData) {
  const state = readState();

  // If stop_hook_active is true, Claude is already in a stop-hook cycle — don't block again
  if (hookData.stop_hook_active) {
    writeState({ ...state, consecutiveBlocks: 0 });
    return;
  }

  // Prevent infinite loops: after 3 consecutive blocks, allow stop
  if (state.consecutiveBlocks >= 3) {
    writeState({ ...state, consecutiveBlocks: 0 });
    return;
  }

  const messages = await fetchMessagesSince(state.lastChecked);
  writeState({ ...state, lastChecked: new Date().toISOString() });

  if (messages.length === 0) {
    writeState({ ...state, lastChecked: new Date().toISOString(), consecutiveBlocks: 0 });
    return;
  }

  const formatted = formatMessages(messages);
  writeState({
    lastChecked: new Date().toISOString(),
    consecutiveBlocks: state.consecutiveBlocks + 1,
  });

  output({
    decision: 'block',
    reason: `Workspace messages arrived:\n\n${formatted}\n\nRead and respond using post_message.`,
  });
}

// ── Main ─────────────────────────────────────────────────

function output(obj) {
  process.stdout.write(JSON.stringify(obj));
}

async function main() {
  if (!PANE_ID || !WORKSPACE_ID) {
    process.exit(0);
  }

  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const event = hookData.hook_event_name;

  try {
    switch (event) {
      case 'SessionStart':
        await handleSessionStart();
        break;
      case 'UserPromptSubmit':
        await handleUserPromptSubmit();
        break;
      case 'Stop':
        await handleStop(hookData);
        break;
    }
  } catch {
    // Fail open: never block Claude due to hook failure
  }
}

main();
