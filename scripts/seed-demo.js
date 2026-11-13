#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Seed a demo workspace for the TUI demo (scripts/tui-demo.tape).
//
// Creates a "Demo" workspace and spawns a handful of agent panes with canned
// prompts, so the terminal client's sidebar shows agents across real states —
// working (◐), done (✓), and idle (○). Run this right before rendering:
//
//     node scripts/seed-demo.js && vhs scripts/tui-demo.tape
//
// HOW IT WORKS
//   Panes go live exactly the way the web UI makes them go live: create the
//   pane row over the REST API, then open the terminal-server WebSocket for
//   it (which spawns the PTY and launches the agent), then type a prompt.
//   Spawned panes persist on the server after this script disconnects — the
//   state-detection engine runs server-side — so the sidebar keeps showing
//   live state when you open `spaces tui`.
//
// REQUIREMENTS (read before running)
//   - A Spaces server running in DESKTOP mode on this machine (`spaces`).
//     It signs its requests with this account's ~/.spaces secret, as the
//     bundled tools do; in multiuser mode it won't authenticate.
//   - The agents you list in PANES must be installed and authenticated
//     (`claude`, `codex`, …). This spawns REAL agents and SPENDS TOKENS.
//   - Node's `ws` package (a project dependency — run from the repo, or
//     `npm i` first).
//
// TUNING
//   - Point PANES at agents you actually have, and edit the prompts.
//   - "blocked" isn't seeded here because it depends on an agent hitting an
//     approval/selection prompt, which is agent- and config-specific. To show
//     it, add a pane whose prompt asks the agent to run a command it will ask
//     to approve.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { spacesHome } = require('../bin/lib/spaces-home');

// ── Config ───────────────────────────────────────────────────────────────
const CWD = process.env.SPACES_DEMO_CWD || process.cwd();

// Each entry becomes one pane. `prompt: null` leaves the agent sitting at its
// input box (idle ○). A short prompt finishes fast (done ✓). A long prompt
// keeps the agent busy while you record (working ◐).
const PANES = [
  { title: 'architect', agentType: 'claude', color: '#a78bfa',
    prompt: 'Draft a thorough, sectioned design for a rate limiter: requirements, 3 algorithm options with tradeoffs, a recommendation, and a rollout plan. Take your time and be detailed.' },
  { title: 'refactor',  agentType: 'claude', color: '#f59e0b',
    prompt: 'Explain, step by step and in depth, how a Bloom filter works and when to use one. Include worked math for the false-positive rate.' },
  { title: 'reviewer',  agentType: 'claude', color: '#34d399',
    prompt: 'Reply with just the word: ready.' },
  { title: 'scratch',   agentType: 'claude', color: '#60a5fa',
    prompt: null },
];

// ── Server address (desktop mode) ────────────────────────────────────────
function serverPort() {
  if (process.env.SPACES_PORT) return parseInt(process.env.SPACES_PORT, 10);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(spacesHome(), 'server.json'), 'utf-8'));
    if (cfg.port) return parseInt(cfg.port, 10);
  } catch { /* default */ }
  return 3457;
}
const PORT = serverPort();
const BASE = process.env.SPACES_BASE_PATH || '';
const HTTP = `http://127.0.0.1:${PORT}${BASE}`;
const WS = `ws://127.0.0.1:${PORT}${BASE}/ws`;
// Short-lived owner tokens, signed with ~/.spaces/internal_token.
const { clientAuthHeaders } = require('../bin/lib/desktop-auth');

// ── Helpers ──────────────────────────────────────────────────────────────
async function api(method, route, body) {
  const res = await fetch(`${HTTP}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...clientAuthHeaders(HTTP) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

// Open the pane's WebSocket (spawns the agent), optionally type a prompt,
// then close. The PTY keeps running server-side.
function spawnAndPrompt(pane) {
  return new Promise((resolve) => {
    const params = new URLSearchParams({
      paneId: pane.id,
      cwd: CWD,
      agentType: pane.agentType,
      cols: '120',
      rows: '30',
    });
    const ws = new WebSocket(`${WS}?${params}`, { headers: clientAuthHeaders(HTTP) });
    let settled = false;
    const done = () => { if (!settled) { settled = true; try { ws.close(); } catch {} resolve(); } };

    ws.on('open', () => {
      // Give the agent a moment to reach its input prompt before typing.
      setTimeout(() => {
        if (pane.prompt) ws.send(JSON.stringify({ type: 'data', data: pane.prompt + '\r' }));
        // Let the prompt land and the agent start working, then disconnect.
        setTimeout(done, 2500);
      }, 4000);
    });
    ws.on('error', (e) => { console.error(`  ! ${pane.title}: ws error — ${e.message}`); done(); });
    // Safety timeout so one stuck pane can't hang the whole seed.
    setTimeout(done, 20000);
  });
}

// ── Run ──────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Seeding demo workspace against ${HTTP}`);

  const ws = await api('POST', '/api/workspaces', { name: 'Demo', color: '#8b5cf6' });
  const workspaceId = ws.id;
  console.log(`  ✓ workspace "Demo" (id ${workspaceId})`);
  try { await api('POST', '/api/workspaces', { action: 'switch', workspaceId }); } catch {}

  for (let i = 0; i < PANES.length; i++) {
    const p = PANES[i];
    const pane = await api('POST', '/api/panes', {
      workspaceId, agentType: p.agentType, title: p.title, color: p.color, cwd: CWD, sortOrder: i,
    });
    p.id = pane.id;
    console.log(`  ✓ pane "${p.title}" (${p.agentType}) — spawning…`);
    await spawnAndPrompt(p);
  }

  console.log('\nDone. Open the terminal client to see the sidebar populate:');
  console.log('  spaces tui');
  console.log('\nThen render:  vhs scripts/tui-demo.tape');
  process.exit(0);
})().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  console.error('Is a Spaces server running in desktop mode on this machine?');
  process.exit(1);
});
