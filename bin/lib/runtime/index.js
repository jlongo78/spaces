'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventHub } = require('./event-hub');
const { PaneStateStore, AGENT_STATES } = require('./state');
const { PaneScreen } = require('./screen');
const { PROTOCOL_VERSION } = require('./protocol');
const { createRegistry } = require('./detect/registry');
const { createScheduler } = require('./detect/scheduler');
const { ENGINE_VERSION } = require('./detect/manifest');
const { refreshManifests, DEFAULT_INDEX_URL } = require('./detect/update');
const { createNotifier } = require('./notify');
const { createSessionStore } = require('./session-store');
const { createDbWatcher } = require('./db-watch');
const { createGitTracker } = require('./git-status');
const { createClaudeSessionWatcher } = require('./claude-sessions');
const { dispatchFile, FILE_METHODS } = require('./files');
const { spawnPane, buildLaunchCommand, buildPaneEnv, canResume } = require('./spawn-pane');
const { encodePrompt, PROMPT_STALL_MS } = require('./agent-control');
const crypto = require('crypto');
const { spacesHome } = require('../spaces-home');

// The async ones are intercepted by the control channel before dispatch()
// ever sees them; dispatch()'s own case for each returns an honest "call it
// asynchronously instead" error. Module-scoped (not declared inside
// createRuntime) so tests can import it directly rather than only observing
// it indirectly through a runtime instance's node.methods response.
const ASYNC_METHODS = ['agent.prompt-wait', 'agent.wait', 'detect.update', 'net.request', 'net.snapshot'];

// Every `case` string in dispatch()'s switch below, including 'node.methods'
// itself. This literal is checked two separate ways by
// tests/proto/contract.test.ts: (1) node.methods' response must equal the
// committed method-catalogue.json fixture, which only catches this literal
// (or the fixture) going stale relative to *each other* — and (2), the
// exhaustiveness check, this literal must equal — in both directions — the
// actual set of case labels read out of this file's own switch, which is
// what catches a case added to the switch and never added here (a method
// that would otherwise silently never appear in node.methods).
const DISPATCH_METHODS = [
  'session.snapshot', 'node.info', 'node.methods',
  'pane.focus', 'pane.read', 'pane.input', 'pane.resize',
  'detect.explain', 'detect.manifests', 'detect.reload', 'detect.update',
  'pane.create', 'pane.close', 'pane.update', 'pane.restart',
  'fs.folders', ...FILE_METHODS,
  'workspace.create', 'workspace.update', 'workspace.close',
  'pane.move',
  'agent.start', 'agent.prompt', 'agent.wait', 'agent.prompt-wait',
  'net.peers', 'net.pair', 'net.forget', 'net.snapshot', 'net.request',
  'session.list',
];

/**
 * How long a session label may be before it is trimmed.
 *
 * A picker row, not a transcript. Long enough to recognise a conversation,
 * short enough that twenty of them are scannable.
 */
const SESSION_LABEL_MAX = 72;

/**
 * A one-line, human-recognisable name for a past session.
 *
 * Resolved here so no client reimplements the precedence — custom name, then
 * summary, then first prompt, then the bare id.
 *
 * The trimming is not cosmetic. A real `first_prompt` in this database begins
 * `<local-command-caveat>Caveat: The messages below were generated…` — harness
 * scaffolding a client pasted, which is nobody's description of anything. Rows
 * like that were indistinguishable from each other in a picker. Leading
 * pseudo-tags and collapsed whitespace go first, and anything left with no
 * ordinary prose falls through to the id, which at least does not pretend.
 */
function sessionLabel(row) {
  const clean = (value) => {
    if (typeof value !== 'string') return '';
    const text = value
      // Angle-bracket tags a harness wrapped round the real message.
      .replace(/<\/?[a-zA-Z][\w-]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Nothing but punctuation and separators is not a label.
    if (!/[a-zA-Z0-9]/.test(text)) return '';
    // Harness preamble, not a description. `first_prompt` is truncated when
    // stored, so for these rows the user's actual message was cut off before
    // it ever landed — there is nothing to recover by stripping the prefix,
    // and two such sessions were indistinguishable from each other.
    if (/^Caveat: The messages below were generated/i.test(text)) return '';
    return text.length > SESSION_LABEL_MAX
      ? text.slice(0, SESSION_LABEL_MAX - 1).trimEnd() + '…'
      : text;
  };
  return (
    clean(row.custom_name) ||
    clean(row.summary) ||
    clean(row.first_prompt) ||
    // Says plainly that there is no description, rather than repeating noise.
    // The picker shows date, message count and branch alongside, so a row is
    // still identifiable without one.
    (row.session_id ? `unnamed · ${String(row.session_id).slice(0, 8)}` : '')
  );
}

/**
 * The folders a directory browser may show: the user's dev directories from
 * ~/.spaces/config.json, or their home directory when none are set — the
 * same rule as the web app's folder picker (src/app/api/folders/route.ts).
 * Read afresh on every call, so editing the list needs no restart.
 */
function readDevRoots(spacesDir, home = os.homedir()) {
  let dirs = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(spacesDir, 'config.json'), 'utf-8'));
    if (Array.isArray(cfg.devDirectories)) dirs = cfg.devDirectories.filter(d => typeof d === 'string' && d);
  } catch { /* no config: home only */ }
  const roots = [];
  for (const d of dirs.length ? dirs : [home]) {
    try { roots.push((fs.realpathSync.native || fs.realpathSync)(path.resolve(d))); } catch { /* missing dir: skip */ }
  }
  return roots;
}

/**
 * One level of the folder tree at `dir` (default: the first root), confined
 * to `roots`. Symlinks are resolved before the check, so a link inside a dev
 * directory cannot lead the browser out of it. Hidden folders and
 * node_modules are left out, as in the web picker.
 */
function listFolders(dir, roots) {
  if (!roots.length) return { ok: false, code: 'not_found', error: 'no dev directories exist' };
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(dir || roots[0]));
  } catch {
    return { ok: false, code: 'not_found', error: `no such folder ${dir}` };
  }
  const within = (root) => resolved === root || resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  const root = roots.find(within);
  if (!root) return { ok: false, code: 'bad_request', error: `${resolved} is outside your dev directories` };
  let entries;
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (e) {
    return { ok: false, code: 'not_found', error: `cannot read ${resolved}: ${e.code || e.message}` };
  }
  const folders = entries
    .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
    .filter(e => {
      if (e.isDirectory()) return true;
      if (!e.isSymbolicLink()) return false;
      try {
        const target = fs.realpathSync(path.join(resolved, e.name));
        return fs.statSync(target).isDirectory() && roots.some(r => target === r || target.startsWith(r + path.sep));
      } catch { return false; }
    })
    .map(e => ({ name: e.name, path: path.join(resolved, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    ok: true,
    result: {
      current: resolved,
      parent: resolved === root ? null : path.dirname(resolved),
      folders,
      roots,
    },
  };
}

/** True when a Claude conversation's transcript is on disk, so `--resume` can find it. */
function claudeSessionExists(sessionId, home = os.homedir()) {
  if (!/^[0-9a-zA-Z-]+$/.test(String(sessionId))) return false;
  const projects = path.join(home, '.claude', 'projects');
  try {
    return fs.readdirSync(projects, { withFileTypes: true })
      .some(d => d.isDirectory() && fs.existsSync(path.join(projects, d.name, `${sessionId}.jsonl`)));
  } catch {
    return false;
  }
}

function createRuntime({ nodeId = 'local', spacesDbPath, getApiPort, federationDbPath, watchDb = false, trackGit = false, trackClaudeSessions = false } = {}) {
  // Resolved lazily (called at spawn time, not captured once here) because
  // terminal-server.js's own API_PORT is a `let` that "attached" mode
  // updates after the HTTP server starts listening — capturing it eagerly
  // could bake in a stale port for panes spawned via pane.create. Defaults
  // to the same env-or-3457 fallback terminal-server.js itself starts with,
  // so a runtime built without wiring one still gets a sane value.
  const resolveApiPort = getApiPort || (() => parseInt(process.env.SPACES_PORT || '3457', 10));
  const hub = new EventHub();
  /**
   * Outbound links to peers, installed by the host when federation is enabled
   * (`attachPeerLinks`). Null on a machine that never federates, which is what
   * `net.snapshot` reports rather than pretending the peer is merely offline.
   */
  let links = null;
  // The fleet is lazy about its database and treats "no peer table" as an
  // empty fleet, so a machine that has never federated pays nothing for this.
  const fleet = require('../network/fleet').createFleet({
    nodeId,
    ...(federationDbPath ? { dbPath: federationDbPath } : {}),
    emit: (type, payload) => hub.emit(type, payload),
    // Read at call time, not captured: links are installed after the runtime
    // exists, and a machine being talked to right now must not still read as
    // whatever was last written to the database.
    statusOf: (peerId) => (links ? links.statusOf(peerId) : null),
  });
  const state = new PaneStateStore(hub);
  /** paneId -> { screen, onInput, onResize, dataSubs:Set, controller, term } */
  const live = new Map();

  const detectRegistry = createRegistry({
    bundledDir: path.join(__dirname, 'detect', 'manifests'),
    userDir: path.join(spacesHome(), 'detection'),
    cacheDir: path.join(spacesHome(), 'detection', '.cache'),
    log: msg => console.warn(msg),
  });
  const detect = createScheduler({
    registry: detectRegistry,
    getScreen: paneId => live.get(paneId)?.screen,
    state,
    log: msg => console.warn(msg),
  });
  detect.start();

  const detectCacheDir = path.join(spacesHome(), 'detection', '.cache');
  const detectIndexUrl = process.env.SPACES_DETECTION_INDEX_URL || DEFAULT_INDEX_URL;
  function refreshDetectionManifests() {
    if (process.env.SPACES_NO_DETECTION_UPDATE === '1') {
      return Promise.resolve({ updated: [], skipped: [{ agent: '*', reason: 'updates disabled' }] });
    }
    return refreshManifests({
      cacheDir: detectCacheDir,
      registry: detectRegistry,
      indexUrl: detectIndexUrl,
      log: msg => console.warn(msg),
    });
  }
  // Refresh once shortly after start, then daily. Failures are non-fatal.
  // The timers themselves (not just refreshDetectionManifests' body) are
  // gated on the opt-out: constructing a timer at all — even unref'd — means
  // a long-lived test worker process can still fire a genuine outbound
  // request mid-suite before the timer would ever be cleared.
  if (process.env.SPACES_NO_DETECTION_UPDATE !== '1') {
    const firstRefresh = setTimeout(() => { refreshDetectionManifests().catch(() => {}); }, 30_000);
    if (firstRefresh.unref) firstRefresh.unref();
    const refreshTimer = setInterval(() => { refreshDetectionManifests().catch(() => {}); }, 24 * 60 * 60 * 1000);
    if (refreshTimer.unref) refreshTimer.unref();
  }

  const sessionStore = createSessionStore({ dbPath: spacesDbPath });
  // config.json lives beside spaces.db; see readDevRoots.
  const devRoots = () => readDevRoots(spacesDbPath ? path.dirname(spacesDbPath) : spacesHome());
  // Replays other processes' writes to spaces.db (the web app's, chiefly)
  // as hub events, so every /proto client sees them live. See db-watch.js.
  // Opt-in: watching holds the store's connection open from the start, which
  // on Windows keeps the file from being deleted — fine for the server, not
  // for a test that removes its temporary database afterwards.
  const dbWatcher = watchDb
    ? createDbWatcher({ withConnection: sessionStore.withConnection, hub, state })
    : null;

  const notifySinks = new Set();
  const notifier = createNotifier({
    state,
    deliver: signal => {
      for (const sink of notifySinks) {
        try { sink(signal); } catch { /* sink errors stay local */ }
      }
      hub.emit('pane.notify', signal);
    },
  });
  hub.subscribe(event => {
    if (event.type === 'pane.state') notifier.onStateEvent(event.payload);
  });
  // The scheduler's own tick only runs while dirty panes exist; deferred
  // notifications must still fire on their own clock regardless of PTY
  // activity, so flush on an independent interval rather than piggybacking
  // on detect.tick.
  const notifyTimer = setInterval(() => notifier.flush(), 250);
  if (notifyTimer.unref) notifyTimer.unref();

  // Opened lazily and closed immediately after each use (rather than cached
  // for the process lifetime like admin.db in terminal-server.js): a
  // held-open readonly handle would lock the underlying file on Windows,
  // and snapshot() is not a hot path, so the extra open/close per call is
  // cheap in exchange for never leaking a handle to a DB file that may be
  // rotated or deleted by the owning Spaces process.
  function withDb(fn) {
    if (!spacesDbPath || !fs.existsSync(spacesDbPath)) return null;
    let d;
    try {
      const Database = require('better-sqlite3');
      d = new Database(spacesDbPath, { readonly: true });
    } catch { return null; }
    try {
      return fn(d);
    } catch {
      return null;
    } finally {
      try { d.close(); } catch { /* already closed / ignore */ }
    }
  }

  function registerPane(paneId, { cols, rows, agentType, cwd, workspaceId, term = null, onInput, onResize }) {
    // Belt-and-braces: callers should never re-register a still-live paneId
    // (handleConnection only calls this on the fresh-spawn path), but if one
    // slips through, dispose the previous PaneScreen first rather than
    // silently leaking a headless xterm instance.
    const prev = live.get(paneId);
    if (prev) { try { prev.screen.dispose(); } catch { /* already disposed */ } }
    const screen = new PaneScreen({
      cols, rows,
      onTitle: t => state.setTitle(paneId, t),
    });
    // `term` (optional) lets a caller that already has the PTY handle (i.e.
    // spawnPane, for both the legacy /ws path and pane.create) attach it to
    // the live record up front, so pane.close/workspace.close can actually
    // kill it later instead of finding rec.term stuck at null.
    live.set(paneId, { screen, onInput, onResize, dataSubs: new Set(), controller: null, term });
    state.open(paneId, { agentType, cwd, workspaceId });
    detect.track(paneId, agentType);
    return { screen };
  }

  function feed(paneId, data) {
    const rec = live.get(paneId);
    if (!rec) return;
    // xterm's write() is asynchronous — the callback fires only after `data`
    // has actually been parsed into the buffer. Marking dirty synchronously
    // (kept below for prompt evaluation of already-parsed state) is not
    // enough on its own: a 300ms tick landing inside that parse window would
    // evaluate the stale grid and clear the dirty bit, permanently missing
    // the final transition this chunk produced. Re-marking from the
    // callback guarantees at least one evaluation happens after the parse
    // completes, however the timing lands relative to tick(). markDirty is a
    // no-op once the pane is untracked, so a callback firing after paneExit
    // is harmless.
    rec.screen.write(data, () => detect.markDirty(paneId));
    detect.markDirty(paneId);
    for (const sub of rec.dataSubs) {
      try { sub.onData(data); } catch { /* subscriber errors stay local */ }
    }
  }

  function paneExit(paneId, exitCode) {
    state.close(paneId, exitCode);
    const rec = live.get(paneId);
    if (rec) {
      // Notify every attached pane socket (observers AND the controller)
      // before dropping the record — otherwise an observer sits OPEN
      // forever with no terminal frame, and a controller's input is
      // accepted and silently dropped, both violating the "input disabled
      // while down — never silently dropped" rule. Snapshot the Set first:
      // onExit typically closes the socket, whose 'close' handler calls
      // back into unsubscribe() and would otherwise mutate dataSubs while
      // this loop is iterating it.
      for (const sub of [...rec.dataSubs]) {
        try { sub.onExit?.(exitCode); } catch { /* subscriber errors stay local */ }
      }
      detect.untrack(paneId);
      notifier.forget(paneId);
      rec.screen.dispose();
      live.delete(paneId);
    }
  }

  // `onExit` is optional so existing single-callback subscribers (and
  // dataSubs' original binary-streaming-only shape) keep working unchanged.
  function subscribePaneData(paneId, onData, onExit) {
    const rec = live.get(paneId);
    if (!rec) return () => {};
    const sub = { onData, onExit };
    rec.dataSubs.add(sub);
    return () => rec.dataSubs.delete(sub);
  }

  function writePane(paneId, data) {
    const rec = live.get(paneId);
    if (!rec) return false;
    rec.onInput(data);
    return true;
  }

  function resizePane(paneId, cols, rows) {
    const rec = live.get(paneId);
    if (!rec) return false;
    rec.screen.resize(cols, rows);
    rec.onResize(cols, rows);
    return true;
  }

  function getScreen(paneId) { return live.get(paneId)?.screen; }

  // Per-pane single-controller slot: `releaseFn` is the caller's own demotion
  // callback, used as the token identifying which socket currently holds
  // control (mirrors the dataSubs pattern above — no separate id needed).
  function claimController(paneId, releaseFn, { takeover = false } = {}) {
    const rec = live.get(paneId);
    if (!rec) return { ok: false, reason: 'not_found' };
    if (rec.controller && !takeover) return { ok: false, reason: 'conflict' };
    const previous = rec.controller;
    rec.controller = releaseFn;
    if (previous) { try { previous(); } catch { /* previous controller cleanup */ } }
    return { ok: true };
  }

  function releaseController(paneId, releaseFn) {
    const rec = live.get(paneId);
    if (rec && rec.controller === releaseFn) rec.controller = null;
  }

  function snapshot() {
    const workspaces = new Map(); // id -> { id, name, color, paneIds }
    const panes = new Map();      // id -> PaneInfo
    // Column names verified against src/lib/db/schema.ts. DB failure (or
    // absence) degrades gracefully to a runtime-only view.
    withDb((d) => {
      for (const w of d.prepare('SELECT id, name, color FROM workspaces').all()) {
        workspaces.set(`w${w.id}`, { id: `w${w.id}`, name: w.name ?? '', color: w.color ?? null, paneIds: [] });
      }
      // `title` and `color` are NOT NULL in the production schema, but a
      // database written by an older build — or a partial mirror, which is
      // what every test fixture is — may not have them. Selecting a column
      // that does not exist throws, and `withDb` swallows it, so the whole
      // pane list would silently vanish from the snapshot rather than
      // arriving without a color. Ask the table what it has instead.
      const paneColumns = new Set(d.prepare('PRAGMA table_info(panes)').all().map(c => c.name));
      const optional = ['title', 'color'].filter(c => paneColumns.has(c));
      const paneSelect = ['id', 'workspace_id', 'agent_type', 'cwd', ...optional].join(', ');
      for (const p of d.prepare(`SELECT ${paneSelect} FROM panes`).all()) {
        const wid = p.workspace_id != null ? `w${p.workspace_id}` : null;
        panes.set(String(p.id), {
          id: String(p.id), workspaceId: wid,
          agentType: p.agent_type || 'shell', agentState: 'unknown',
          seen: true, title: p.title || '', cwd: p.cwd || '', sessionRef: null, live: false,
          color: p.color || null,
        });
        if (wid && workspaces.has(wid)) workspaces.get(wid).paneIds.push(String(p.id));
      }
    });
    for (const r of state.snapshotPanes()) {
      const base = panes.get(r.paneId) || {
        id: r.paneId, workspaceId: r.workspaceId, agentType: r.agentType,
        agentState: 'unknown', seen: true, title: '', cwd: r.cwd, sessionRef: null, live: false,
        color: null,
      };
      panes.set(r.paneId, {
        ...base,
        agentType: r.agentType, agentState: r.agentState, seen: r.seen,
        sessionRef: r.sessionRef, live: r.live,
        // The live record wins only when it has something to say. A pane that
        // has not emitted an OSC title yet reports `''`, and letting that
        // overwrite the persisted title would blank a user's rename on every
        // snapshot. Same for `color`, which only `pane.update` ever sets.
        title: r.title || base.title,
        color: r.color ?? base.color,
      });
    }
    // A pane can reference a workspaceId the DB never provided (DB
    // missing/unreadable, or the pane not yet persisted — the legacy /ws
    // path never calls sessionStore.createPane at all, so EVERY pane it
    // spawns is in this position) — every pane still present in the state
    // store must still be reachable via workspaces[].paneIds, so backfill a
    // stub workspace and/or membership rather than leaving it orphaned. Not
    // conditioned on `live`: a pane that exited naturally keeps showing
    // "recently exited" here exactly as it did before the closed-workspace
    // fix below — state.close() alone (a natural exit) never drops the
    // record, only state.remove() does. A pane that no longer belongs here
    // (torn down via pane.close/workspace.close) is handled upstream of
    // this loop entirely: those call state.remove(), which deletes the
    // record outright, so it's already absent from `panes` by the time this
    // loop runs — no live check needed to exclude it. (A broader `!p.live`
    // skip here was tried and reverted: it silently dropped every
    // naturally-exited, never-persisted pane — the common case for legacy
    // /ws panes — from its workspace's paneIds, which the closed-workspace
    // fix never intended to change.)
    for (const p of panes.values()) {
      if (!p.workspaceId) continue;
      let ws = workspaces.get(p.workspaceId);
      if (!ws) {
        ws = { id: p.workspaceId, name: '', color: null, paneIds: [] };
        workspaces.set(p.workspaceId, ws);
      }
      if (!ws.paneIds.includes(p.id)) ws.paneIds.push(p.id);
    }
    if (gitTracker) {
      for (const ws of workspaces.values()) ws.git = gitTracker.get(ws.id);
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      nodeId,
      seq: hub.lastSeq,
      workspaces: [...workspaces.values()],
      panes: [...panes.values()],
    };
  }

  // Each space's branch for the sidebar, refreshed off the request path.
  // Opt-in for the same reason as watchDb: it runs git on a timer.
  const gitTracker = trackGit
    ? createGitTracker({
      spaceDirs: () => snapshot().workspaces.map((ws) => {
        const first = ws.paneIds.length ? snapshotPaneCwd(ws.paneIds[0]) : null;
        return [ws.id, first];
      }),
      onChange: (workspaceId, git) => hub.emit('workspace.updated', { workspaceId, git }),
    })
    : null;

  // Which conversation each live Claude pane runs, recorded so a restart
  // resumes it. Opt-in, like trackGit: it reads the process table on a timer.
  const claudeSessions = trackClaudeSessions
    ? createClaudeSessionWatcher({
      listPanes: () => [...live.entries()]
        .filter(([paneId, rec]) => rec.term && state.get(paneId)?.live && state.get(paneId)?.agentType === 'claude')
        .map(([paneId, rec]) => ({ paneId, pid: rec.term.pid, sessionId: state.get(paneId)?.sessionRef?.id ?? null })),
      onSession: (paneId, sessionId) => {
        sessionStore.setClaudeSession(paneId, sessionId);
        state.setSessionRef(paneId, { id: sessionId, transcriptPath: null });
      },
    })
    : null;

  function snapshotPaneCwd(paneId) {
    const rec = state.get(paneId);
    if (rec && rec.cwd) return rec.cwd;
    const row = withDb((d) => d.prepare('SELECT cwd FROM panes WHERE id = ?').get(paneId));
    return row && row.cwd ? row.cwd : null;
  }

  const ok = (result) => ({ result });
  const err = (code, message) => ({ error: { code, message } });
  const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
  const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

  /** 'w12' -> 12; anything else -> null. */
  function workspaceRowId(publicId) {
    const m = /^w(\d+)$/.exec(String(publicId || ''));
    return m ? Number(m[1]) : null;
  }

  // spawnPane needs a runtime handle with registerPane/feed/paneExit.
  // createRuntime's own return value isn't built until the end of this
  // function, so this is a deliberately narrow, fully-built stand-in
  // (never a partially-built object) declared after those three functions
  // exist and before dispatch uses it.
  const publicRuntime = { registerPane, feed, paneExit };

  const MAX_WAIT_MS = 300000;
  const DEFAULT_WAIT_MS = 30000;

  /**
   * Resolve when a pane reaches one of `until`. Never rejects: a timeout
   * resolves {ok:false, code:'timeout'}, and any synchronous throw from the
   * hub subscription itself (should the hub implementation ever change)
   * resolves {ok:false, code:'internal'} instead of escaping as a rejection
   * or an uncaught exception — either way the caller can branch on the
   * result without a try/catch.
   */
  function awaitAgentState({ paneId, until, timeoutMs } = {}) {
    if (!isNonEmptyString(paneId)) {
      return Promise.resolve({ ok: false, code: 'bad_request', error: 'paneId must be a non-empty string' });
    }
    if (!Array.isArray(until) || !until.length) {
      return Promise.resolve({ ok: false, code: 'bad_request', error: 'until must be a non-empty array of states' });
    }
    const bad = until.filter(s => !AGENT_STATES.includes(s));
    if (bad.length) {
      return Promise.resolve({ ok: false, code: 'bad_request', error: `unknown state(s): ${bad.join(', ')}` });
    }
    const rec = state.get(paneId);
    if (!rec) return Promise.resolve({ ok: false, code: 'not_found', error: `no pane ${paneId}` });
    if (until.includes(rec.agentState)) return Promise.resolve({ ok: true, state: rec.agentState });

    const budget = Math.min(isPositiveInt(timeoutMs) ? timeoutMs : DEFAULT_WAIT_MS, MAX_WAIT_MS);
    return new Promise(resolve => {
      let done = false;
      // Initialized to a no-op before subscribe runs: if subscribe itself
      // throws below, `finish` (invoked from the catch block) must still
      // have a safe function to call, and no later-firing timer callback
      // may ever close over a still-uninitialized binding.
      let unsubscribe = () => {};
      let timer;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(result);
      };
      try {
        // Subscribe before scheduling the timer: if subscribe throws, no
        // timer callback closing over `unsubscribe` can ever be scheduled.
        unsubscribe = hub.subscribe(event => {
          if (event.payload?.paneId !== paneId) return;
          if (event.type === 'pane.state') {
            if (until.includes(event.payload.agentState)) finish({ ok: true, state: event.payload.agentState });
            return;
          }
          // The pane closing mid-wait (pane.close/workspace.close, or a
          // natural exit) previously went unnoticed here — only pane.state
          // was watched, so the wait burned its full timeout budget and
          // resolved with a misleading `timeout` instead of reporting the
          // pane is simply gone.
          if (event.type === 'pane.closed') {
            finish({ ok: false, code: 'not_found', error: `pane ${paneId} closed while waiting` });
          }
        });
        timer = setTimeout(
          () => finish({ ok: false, code: 'timeout', error: `pane ${paneId} did not reach ${until.join('|')} in ${budget}ms` }),
          budget,
        );
        if (timer.unref) timer.unref();
      } catch (error) {
        finish({ ok: false, code: 'internal', error: String((error && error.message) || error) });
      }
    });
  }

  /** Write a prompt, then wait for ANY state change on that pane. Never
   * rejects and never throws synchronously: a failure subscribing to the
   * hub, or writing the prompt itself, resolves {ok:false, code:'internal'}
   * through the same finish/unsubscribe path as every other exit.
   */
  function promptAndWait({ paneId, text, bracketedPaste, timeoutMs } = {}) {
    if (!isNonEmptyString(paneId)) {
      return Promise.resolve({ ok: false, code: 'bad_request', error: 'paneId must be a non-empty string' });
    }
    if (typeof text !== 'string') {
      return Promise.resolve({ ok: false, code: 'bad_request', error: 'text must be a string' });
    }
    const rec = state.get(paneId);
    if (!rec || !live.has(paneId)) {
      return Promise.resolve({ ok: false, code: 'not_found', error: `no live pane ${paneId}` });
    }
    const budget = Math.min(isPositiveInt(timeoutMs) ? timeoutMs : PROMPT_STALL_MS, MAX_WAIT_MS);
    // Both lifted out of the executor (mirroring `unsubscribe` above) so the
    // write step after the Promise constructor — which runs synchronously
    // within this same call — can settle `settled` through the identical
    // finish/unsubscribe path instead of fabricating a second, disconnected
    // Promise.resolve(...) that would leave this one dangling.
    let unsubscribe = () => {};
    let finish = () => {};
    const settled = new Promise(resolve => {
      let done = false;
      let timer;
      finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(result);
      };
      try {
        // Subscribe before writing so a fast agent cannot beat the listener,
        // and before scheduling the timer so a subscribe throw can never
        // leave a timer callback closing over an uninitialized unsubscribe.
        unsubscribe = hub.subscribe(event => {
          if (event.type === 'pane.state' && event.payload.paneId === paneId) {
            finish({ ok: true, state: event.payload.agentState });
          }
        });
        timer = setTimeout(
          () => finish({ ok: false, code: 'agent_prompt_stalled', error: `no lifecycle change within ${budget}ms` }),
          budget,
        );
        if (timer.unref) timer.unref();
      } catch (error) {
        finish({ ok: false, code: 'internal', error: String((error && error.message) || error) });
      }
    });
    let wrote;
    try {
      wrote = writePane(paneId, encodePrompt(text, { bracketedPaste: bracketedPaste === true }));
    } catch (error) {
      finish({ ok: false, code: 'internal', error: String((error && error.message) || error) });
      return settled;
    }
    if (!wrote) {
      finish({ ok: false, code: 'not_found', error: `no live pane ${paneId}` });
      return settled;
    }
    return settled;
  }

  function dispatch(method, params = {}) {
    switch (method) {
      case 'session.snapshot':
        return ok(snapshot());
      case 'node.info':
        // `homeDir` is where `pane.create` puts a pane given no `cwd` of its
        // own (see that method's `os.homedir()` default). A client cannot
        // guess it — the server is routinely a different machine, and a
        // different OS — so without this a "where should this pane start"
        // prompt has nothing to offer for a session with no panes yet, which
        // is exactly the session where the user has least idea what to type.
        //
        // No new exposure: every pane's `cwd` is already in the snapshot, and
        // reaching this method at all means an authenticated `/proto`
        // connection.
        return ok({
          nodeId,
          protocolVersion: PROTOCOL_VERSION,
          seq: hub.lastSeq,
          homeDir: os.homedir(),
        });
      // ─── The fleet ──────────────────────────────────────────
      // These return and accept no key material. A peer's API key and its
      // private half of the handshake stay on this machine; the client asks
      // for a machine to be paired and this node does the connecting. The
      // client with the widest reach is therefore the one holding nothing
      // worth stealing.
      case 'session.list': {
        if (!isNonEmptyString(params.cwd)) return err('bad_request', 'cwd must be a non-empty string');
        if (!isNonEmptyString(params.agentType)) {
          return err('bad_request', 'agentType must be a non-empty string');
        }
        // An agent with no resume flag has no resumable sessions by
        // definition. Answered here rather than by the client so the AGENTS
        // table in spawn-pane.js stays the only place that knows.
        if (!canResume(params.agentType)) return ok({ sessions: [] });

        const limit = Number.isInteger(params.limit) && params.limit > 0
          ? Math.min(params.limit, 100)
          : 20;

        // Read-only, and tolerant of a database that predates the table: the
        // web app's indexer owns this data and older installs may not have it.
        // A missing table would otherwise throw inside withDb, which swallows
        // it — the failure shape that silently empties a list.
        const rows = withDb((d) => {
          const present = new Set(
            d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name)
          );
          if (!present.has('sessions')) return [];
          return d.prepare(
            `SELECT session_id, custom_name, summary, first_prompt, message_count,
                    modified, git_branch, agent_type, project_path
               FROM sessions WHERE agent_type = ? ORDER BY modified DESC`
          ).all(params.agentType);
        }) || [];

        // The stored path and the one asked for need not agree character for
        // character; same rule as bin/lib/network/policy.js::isInside.
        const wanted = path.resolve(params.cwd);
        const sameDirectory = (stored) => {
          if (!stored) return false;
          const resolved = path.resolve(stored);
          return process.platform === 'win32'
            ? resolved.toLowerCase() === wanted.toLowerCase()
            : resolved === wanted;
        };

        return ok({
          sessions: rows
            .filter((r) => sameDirectory(r.project_path))
            .slice(0, limit)
            .map((r) => ({
              sessionId: r.session_id,
              // Precedence lives here so no client reimplements it.
              label: sessionLabel(r),
              messageCount: Number.isFinite(r.message_count) ? r.message_count : 0,
              modified: r.modified || null,
              gitBranch: r.git_branch || null,
              agentType: r.agent_type || params.agentType,
            })),
        });
      }

      case 'net.peers':
        return ok({ nodes: fleet.listNodes() });

      case 'net.snapshot':
      case 'net.request':
        // Cross the network to another machine, so they cannot be answered
        // here. Named explicitly rather than falling through to "unknown
        // method", which would be a lie — they exist, they just are not
        // synchronous.
        return err(
          'bad_request',
          `${method} is asynchronous; call it over the control channel`
        );

      case 'net.pair': {
        if (!isNonEmptyString(params.url)) return err('bad_request', 'url must be a non-empty string');
        if (!isNonEmptyString(params.publicKey)) {
          return err('bad_request', 'publicKey must be a non-empty string');
        }
        try {
          const node = fleet.pair({
            url: params.url,
            publicKey: params.publicKey,
            name: isNonEmptyString(params.name) ? params.name : null,
            apiKey: isNonEmptyString(params.apiKey) ? params.apiKey : '',
            nodeId: isNonEmptyString(params.nodeId) ? params.nodeId : null,
          });
          return ok({ node });
        } catch (e) {
          return err('bad_request', `pairing failed: ${e.message}`);
        }
      }

      case 'net.forget': {
        if (!isNonEmptyString(params.nodeId)) {
          return err('bad_request', 'nodeId must be a non-empty string');
        }
        return ok({ ok: fleet.forget(params.nodeId) });
      }

      case 'pane.focus': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        if (!state.get(params.paneId)) return err('not_found', `no pane ${params.paneId}`);
        // Exclusive: unfocuses every other pane so a later completion on the
        // now-unfocused pane can render as "done" again (I5 — pane.focus was
        // one-way, so once focused a pane could never lose focus).
        state.setExclusiveFocus(params.paneId);
        return ok({ ok: true });
      }
      case 'pane.read': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        const screen = getScreen(params.paneId);
        if (!screen) return err('not_found', `no live pane ${params.paneId}`);
        const source = params.source || 'visible';
        if (source === 'detection') return ok(screen.detectionSnapshot());
        return ok({ rows: screen.visibleGrid() });
      }
      case 'pane.input': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        if (typeof params.data !== 'string') return err('bad_request', 'data must be a string');
        return writePane(params.paneId, params.data)
          ? ok({ ok: true }) : err('not_found', `no live pane ${params.paneId}`);
      }
      case 'pane.resize': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        // Bitwise `| 0` silently truncated garbage (NaN, floats, strings) to
        // 0, permanently desyncing the headless screen from the PTY at a
        // 2x1 clamp (I6). Reject anything that isn't a real positive int
        // instead of coercing it.
        if (!isPositiveInt(params.cols) || !isPositiveInt(params.rows)) {
          return err('bad_request', 'cols and rows must be positive integers');
        }
        return resizePane(params.paneId, params.cols, params.rows)
          ? ok({ ok: true }) : err('not_found', `no live pane ${params.paneId}`);
      }
      case 'detect.explain': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        const rec = state.get(params.paneId);
        const last = detect.lastResult(params.paneId);
        if (!rec || !last) return err('not_found', `no detection for pane ${params.paneId}`);
        const source = detectRegistry.sourceOf(rec.agentType);
        const manifest = detectRegistry.get(rec.agentType);
        return ok({
          paneId: params.paneId,
          agentType: rec.agentType,
          agentState: rec.agentState,
          seen: rec.seen,
          detected: { state: last.state, ruleId: last.ruleId, reason: last.reason, at: last.at },
          manifest: manifest
            ? { agent: manifest.agent, version: manifest.version, source }
            : null,
          pendingIdle: detect.pendingIdle(params.paneId),
          evidence: last.evidence,
        });
      }
      case 'detect.manifests':
        return ok({ engineVersion: ENGINE_VERSION, manifests: detectRegistry.list() });
      case 'detect.reload':
        return ok(detectRegistry.reload());
      case 'detect.update':
        // Asynchronous — the control channel intercepts this method before
        // it ever reaches dispatch (see control-channel.js). Reaching this
        // case means a caller invoked dispatch directly, which can't await
        // a promise-shaped result; tell them where to go instead of lying
        // with a synchronous { started: true }.
        return err('bad_request', 'detect.update is asynchronous; call it over the control channel');
      case 'pane.create': {
        if (!isNonEmptyString(params.workspaceId)) return err('bad_request', 'workspaceId must be a non-empty string');
        const rowId = workspaceRowId(params.workspaceId);
        if (rowId === null) return err('bad_request', `workspaceId must look like "w12", got "${params.workspaceId}"`);
        // Canonical form for the DB row, the spawned pane's live record, the
        // emitted event, and the result — same as workspace.create/update/
        // close and pane.move (this previously echoed params.workspaceId raw,
        // so a non-canonical input like "w03" was accepted into the DB row/live
        // record as "3" but echoed back and compared against elsewhere as the
        // literal string "w03", silently breaking a later workspace.close's
        // live-pane match).
        const workspaceId = `w${rowId}`;
        const cols = params.cols === undefined ? 120 : params.cols;
        const rows = params.rows === undefined ? 30 : params.rows;
        if (!isPositiveInt(cols) || !isPositiveInt(rows)) return err('bad_request', 'cols and rows must be positive integers');
        const agentType = isNonEmptyString(params.agentType) ? params.agentType : 'shell';
        const cwd = isNonEmptyString(params.cwd) ? params.cwd : os.homedir();
        // Said plainly, and the same on every platform: where the folder is
        // missing, Linux starts the pane anyway and its shell then fails.
        let isDir = false;
        try { isDir = fs.statSync(cwd).isDirectory(); } catch { /* missing */ }
        if (!isDir) return err('bad_request', `no such folder ${cwd}`);
        const paneId = crypto.randomUUID();

        const written = sessionStore.createPane({
          paneId, workspaceId: rowId, agentType, cwd,
          title: isNonEmptyString(params.title) ? params.title : agentType,
        });
        if (!written.ok) {
          return /no workspace/.test(written.error)
            ? err('not_found', written.error)
            : err('internal', written.error);
        }

        // Shared by both failure branches below: a spawn that throws
        // outright, and a spawn that reports ok:true but whose own
        // best-effort runtime.registerPane call failed and was swallowed
        // (see spawn-pane.js's "runtime bookkeeping is best-effort" catch).
        // Both must leave no DB row behind — logged rather than silently
        // discarded, since a failed delete here means the exact orphan row
        // this rollback exists to prevent.
        const rollbackRow = () => {
          const removed = sessionStore.deletePane(paneId);
          if (!removed.ok) {
            console.error(`pane.create: rollback failed to delete orphan row ${paneId}: ${removed.error}`);
          }
        };

        // Allowlisted env, not process.env: protocol panes exist to run
        // agents, but must never inherit the server's own secrets
        // (SPACES_SESSION_SECRET, GH_PAT, NPM_TOKEN, ANTHROPIC_API_KEY, etc)
        // any more than the legacy /ws path does.
        // Includes the agent-bus wiring (SPACES_PANE_ID/SPACES_API_URL) so
        // agents started in protocol panes can use it.
        const env = buildPaneEnv({ paneId, apiPort: resolveApiPort() });
        const spawned = spawnPane({
          paneId, cwd, agentType, cols, rows,
          env,
          runtime: publicRuntime,
          workspaceId,
          customCommand: params.customCommand,
          agentSession: params.agentSession,
        });
        if (!spawned.ok) {
          rollbackRow(); // no orphan rows
          return err('internal', `spawn failed: ${spawned.error}`);
        }

        const rec = live.get(paneId);
        if (!rec) {
          // The PTY itself spawned (spawned.ok === true) but registration
          // into `live` never landed — the exact swallowed-failure gap
          // above. Left alone this orphans a real process nothing in the
          // server can ever reach again, while telling the client
          // pane.create succeeded. Treat it exactly like a spawn failure:
          // kill the PTY directly (nothing else holds a reference to it),
          // roll back the row, and never emit pane.created.
          try { spawned.term?.kill(); } catch { /* already dead */ }
          rollbackRow();
          return err('internal', 'pane registration failed after spawn');
        }
        // rec.term is already set — spawnPane threads `term` through its own
        // registerPane call now, so both spawn paths get it for free.

        hub.emit('pane.created', { paneId, workspaceId, agentType, cwd });
        return ok({ paneId, workspaceId, agentType, cwd, launchCommand: spawned.launchCommand });
      }

      case 'pane.restart': {
        // Starts a stopped pane again in place: same id, space, folder and
        // agent, so it reappears where it was. A server restart or a reboot
        // stops every pane, and without this a client that lists only
        // running panes had no way to bring them back.
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        if (live.has(params.paneId) && state.get(params.paneId)?.live) {
          return err('bad_request', `pane ${params.paneId} is already running`);
        }
        const row = sessionStore.getPane(params.paneId);
        if (!row) return err('not_found', `no pane ${params.paneId}`);
        const cols = params.cols === undefined ? 120 : params.cols;
        const rows = params.rows === undefined ? 30 : params.rows;
        if (!isPositiveInt(cols) || !isPositiveInt(rows)) return err('bad_request', 'cols and rows must be positive integers');
        const agentType = row.agent_type || 'shell';
        const cwd = row.cwd && fs.existsSync(row.cwd) ? row.cwd : os.homedir();
        const workspaceId = row.workspace_id != null ? `w${row.workspace_id}` : null;
        // Resume the pane's conversation only when it still exists: a
        // `claude --resume` of a missing session fails, leaving the user at
        // a shell prompt instead of in their agent.
        const agentSession = agentType === 'claude' && row.claude_session_id
          && claudeSessionExists(row.claude_session_id) ? row.claude_session_id : undefined;

        const spawned = spawnPane({
          paneId: params.paneId, cwd, agentType, cols, rows,
          env: buildPaneEnv({ paneId: params.paneId, apiPort: resolveApiPort() }),
          runtime: publicRuntime,
          workspaceId,
          customCommand: row.custom_command || undefined,
          agentSession,
        });
        if (!spawned.ok) return err('internal', `spawn failed: ${spawned.error}`);
        if (!live.get(params.paneId)) {
          try { spawned.term?.kill(); } catch { /* already dead */ }
          return err('internal', 'pane registration failed after spawn');
        }
        // spawnPane starts only the shell. A fresh pane gets its agent from
        // the client's follow-up agent.start; a restart types it here, so the
        // pane comes back running what it ran before with no second call.
        if (spawned.launchCommand) writePane(params.paneId, `${spawned.launchCommand}\r`);
        return ok({ paneId: params.paneId, workspaceId, agentType, cwd, resumed: Boolean(agentSession), launchCommand: spawned.launchCommand });
      }

      case 'fs.folders': {
        if (params.path !== undefined && !isNonEmptyString(params.path)) {
          return err('bad_request', 'path must be a non-empty string');
        }
        const listing = listFolders(params.path, devRoots());
        return listing.ok ? ok(listing.result) : err(listing.code, listing.error);
      }

      case 'fs.list': case 'fs.read': case 'fs.write':
      case 'fs.mkdir': case 'fs.move': case 'fs.delete': {
        const res = dispatchFile(method, params, { devRoots: devRoots() });
        return res.ok ? ok(res.result) : err(res.code, res.error);
      }

      case 'pane.close': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        const rec = live.get(params.paneId);
        const removed = sessionStore.deletePane(params.paneId);
        if (!rec && !removed.ok) return err('not_found', `no pane ${params.paneId}`);
        if (rec) {
          try { rec.term?.kill(); } catch { /* already dead */ }
          paneExit(params.paneId, 0);
        }
        // Drop the pane's state record entirely (not just live:false) so it
        // stops appearing in session.snapshot() — a protocol-initiated close
        // has nothing "recently exited" worth showing, unlike a natural PTY
        // exit (paneExit/state.close alone), which still keeps the record.
        state.remove(params.paneId);
        hub.emit('pane.removed', { paneId: params.paneId });
        return ok({ ok: true });
      }

      case 'workspace.create': {
        if (!isNonEmptyString(params.name) || !params.name.trim()) {
          return err('bad_request', 'name must be a non-empty string');
        }
        const created = sessionStore.createWorkspace({
          name: params.name.trim(),
          color: isNonEmptyString(params.color) ? params.color : null,
        });
        if (!created.ok) return err('internal', created.error);
        const workspaceId = `w${created.id}`;
        hub.emit('workspace.created', { workspaceId, name: params.name.trim() });
        return ok({ workspaceId });
      }

      case 'workspace.update': {
        const rowId = workspaceRowId(params.workspaceId);
        if (rowId === null) return err('bad_request', 'workspaceId must look like "w12"');
        // Canonical form for the event payload regardless of how the caller
        // spelled it (e.g. "w01" parses to the same row as "w1" but must not
        // be echoed back verbatim — a client correlating events against
        // session.snapshot() by === would otherwise never match).
        const workspaceId = `w${rowId}`;
        const fields = {};
        if (params.name !== undefined) {
          if (!isNonEmptyString(params.name) || !params.name.trim()) return err('bad_request', 'name must be a non-empty string');
          fields.name = params.name.trim();
        }
        if (params.color !== undefined) {
          // Mirror workspace.create's permissiveness: any non-string value
          // (not just null) clears the color instead of being coerced
          // through String(...), which would otherwise turn e.g. `true`
          // into the literal string "true".
          fields.color = isNonEmptyString(params.color) ? params.color : null;
        }
        if (!Object.keys(fields).length) return err('bad_request', 'nothing to update: provide name and/or color');
        const updated = sessionStore.updateWorkspace(rowId, fields);
        if (!updated.ok) {
          return /no workspace/.test(updated.error) ? err('not_found', updated.error) : err('internal', updated.error);
        }
        hub.emit('workspace.updated', { workspaceId, ...fields });
        return ok({ ok: true });
      }

      case 'workspace.close': {
        const rowId = workspaceRowId(params.workspaceId);
        if (rowId === null) return err('bad_request', 'workspaceId must look like "w12"');
        const workspaceId = `w${rowId}`; // canonical form, see workspace.update above
        // Existence must be confirmed BEFORE anything gets killed: killing a
        // live pane is irreversible, and a well-formed "wN" id is not proof
        // the row still exists — spaces.db is shared with the web app,
        // which can delete a workspace out-of-band. So the DB delete runs
        // first (sessionStore.closeWorkspace already validates existence,
        // and deletes the pane rows explicitly since panes.workspace_id has
        // no FK cascade in production — see session-store.js) and only once
        // it reports success do we touch any PTY. A failure here — not_found
        // or otherwise — now always means truly nothing happened.
        const removed = sessionStore.closeWorkspace(rowId);
        if (!removed.ok) {
          return /no workspace/.test(removed.error) ? err('not_found', removed.error) : err('internal', removed.error);
        }
        // Reconcile the two sources: removed.deletedPaneIds is the DB's view
        // of which rows existed under this workspace; a pane can also be
        // live-but-not-yet-persisted, so walk the runtime's own live records
        // too and kill every live PTY tagged to this workspace (whether or
        // not the DB knew about it), unioning the ids so closedPanes
        // reflects everything that actually went away.
        const closedPanes = [...removed.deletedPaneIds];
        const deletedSet = new Set(removed.deletedPaneIds);
        for (const r of state.snapshotPanes()) {
          if (r.workspaceId !== workspaceId) continue;
          if (r.live) {
            const rec = live.get(r.paneId);
            if (rec) { try { rec.term?.kill(); } catch { /* already dead */ } }
            paneExit(r.paneId, 0);
            if (!deletedSet.has(r.paneId)) closedPanes.push(r.paneId);
          }
          // Drop the record entirely (live or not) so a later snapshot can't
          // resurrect this workspace as a nameless stub around a pane that no
          // longer exists — covers both the just-killed live pane above and any
          // lingering non-live record (e.g. one that exited naturally before
          // the workspace was closed).
          state.remove(r.paneId);
        }
        hub.emit('workspace.removed', { workspaceId, closedPanes });
        return ok({ ok: true, closedPanes });
      }

      case 'pane.move': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        const rowId = workspaceRowId(params.workspaceId);
        if (rowId === null) return err('bad_request', 'workspaceId must look like "w12"');
        const workspaceId = `w${rowId}`; // canonical form, see workspace.update above
        const moved = sessionStore.movePane(params.paneId, rowId);
        if (!moved.ok) {
          return /no pane|no workspace/.test(moved.error) ? err('not_found', moved.error) : err('internal', moved.error);
        }
        // Keep the live record in step so the next snapshot agrees with the DB.
        const rec = state.get(params.paneId);
        if (rec) rec.workspaceId = workspaceId;
        hub.emit('pane.moved', { paneId: params.paneId, workspaceId });
        return ok({ ok: true });
      }

      case 'pane.update': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        const fields = {};
        if (params.title !== undefined) {
          // Unlike a workspace name, an empty title is meaningful: it hands
          // the pane back to its own OSC title, which is the only way to undo
          // a rename. So it is checked for being a *string*, not for being
          // non-empty.
          if (typeof params.title !== 'string') return err('bad_request', 'title must be a string');
          fields.title = params.title.trim();
        }
        if (params.color !== undefined) {
          // `color` is NOT NULL in the panes table (src/lib/db/schema.ts), so
          // clearing it means the empty string rather than null — the same
          // permissiveness workspace.update has, with the storage difference
          // that forces a different sentinel.
          fields.color = isNonEmptyString(params.color) ? params.color : '';
        }
        if (!Object.keys(fields).length) return err('bad_request', 'nothing to update: provide title and/or color');

        // Persist first, then the live record: a write that fails must not
        // leave the runtime reporting a title the database never took, which
        // the next snapshot would silently revert.
        const written = sessionStore.updatePane(params.paneId, fields);
        if (!written.ok) {
          return /no pane/.test(written.error) ? err('not_found', written.error) : err('internal', written.error);
        }
        // Both setters emit `pane.updated` themselves, so a client sees one
        // event per field actually changed. Absent from `live` is fine — a
        // pane row can outlive its process, and the DB write above is what
        // the next snapshot reads.
        if (Object.prototype.hasOwnProperty.call(fields, 'title')) state.setUserTitle(params.paneId, fields.title);
        if (Object.prototype.hasOwnProperty.call(fields, 'color')) state.setColor(params.paneId, fields.color || null);
        return ok({ ok: true, ...fields });
      }

      case 'agent.start': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        if (!isNonEmptyString(params.agentType)) return err('bad_request', 'agentType must be a non-empty string');
        if (!live.has(params.paneId)) return err('not_found', `no live pane ${params.paneId}`);
        const launchCommand = buildLaunchCommand({
          agentType: params.agentType,
          agentSession: params.agentSession,
          customCommand: params.customCommand,
        });
        if (!launchCommand) return err('bad_request', `agentType "${params.agentType}" has no launch command`);
        if (!writePane(params.paneId, `${launchCommand}\r`)) {
          return err('not_found', `no live pane ${params.paneId}`);
        }
        return ok({ ok: true, launchCommand });
      }

      case 'agent.prompt': {
        if (!isNonEmptyString(params.paneId)) return err('bad_request', 'paneId must be a non-empty string');
        if (typeof params.text !== 'string') return err('bad_request', 'text must be a string');
        if (!live.has(params.paneId)) return err('not_found', `no live pane ${params.paneId}`);
        const encoded = encodePrompt(params.text, { bracketedPaste: params.bracketedPaste === true });
        if (!writePane(params.paneId, encoded)) return err('not_found', `no live pane ${params.paneId}`);
        return ok({ ok: true });
      }

      case 'agent.wait':
        return err('bad_request', 'agent.wait is asynchronous; call it over the control channel');
      case 'agent.prompt-wait':
        return err('bad_request', 'agent.prompt-wait is asynchronous; call it over the control channel');

      case 'node.methods':
        return ok({
          protocolVersion: PROTOCOL_VERSION,
          sync: DISPATCH_METHODS.slice().sort(),
          async: ASYNC_METHODS.slice().sort(),
        });

      default:
        return err('bad_request', `unknown method ${method}`);
    }
  }

  /**
   * Fetches another machine's snapshot through this node's outbound link.
   *
   * Async, unlike `dispatch`, because it crosses a network. The client asks
   * this node rather than the peer directly: the credentials for that link
   * live here, and keeping them here is what lets the client hold none.
   */
  async function peerSnapshot({ nodeId } = {}) {
    if (!links) throw new Error('federation is not enabled on this machine');
    if (!nodeId) throw new Error('nodeId is required');
    return links.request(nodeId, 'session.snapshot', {});
  }

  /**
   * Runs a method on another machine through this node's outbound link.
   *
   * The general form of `net.snapshot`, and what lets a client act on a remote
   * machine at all rather than only read it: creating a space, starting a
   * pane, renaming one. Without it every write went to whichever machine the
   * client happened to be connected to, however clearly it had selected
   * another.
   *
   * **This node does not decide what is permitted.** The request travels the
   * federated link and lands on the peer's own control channel, where the
   * peer's policy gates it — the allow-list, the dev-directory confinement,
   * the read-only setting. A machine is the only thing entitled to say what
   * may be done to it, so there is deliberately no second check here that
   * could drift out of step with the one that matters.
   */
  async function peerRequest({ nodeId, method, params } = {}) {
    if (!links) throw new Error('federation is not enabled on this machine');
    if (!nodeId) throw new Error('nodeId is required');
    if (!method) throw new Error('method is required');
    return links.request(nodeId, method, params || {});
  }

  return {
    hub, state, sessionStore, dbWatcher, gitTracker, claudeSessions,
    registerPane, feed, paneExit,
    subscribePaneData, writePane, resizePane, getScreen,
    claimController, releaseController,
    snapshot, dispatch,
    awaitAgentState, promptAndWait,
    peerSnapshot,
    peerRequest,
    /** Set once by the host when federation is enabled; see `bin/spaces.js`. */
    attachPeerLinks(peerLinks) { links = peerLinks; },
    fleet,
    detect, detectRegistry,
    refreshDetectionManifests,
    notifier, onNotify(fn) { notifySinks.add(fn); return () => notifySinks.delete(fn); },
  };
}

module.exports = { createRuntime, DISPATCH_METHODS, ASYNC_METHODS, claudeSessionExists, listFolders, readDevRoots };
