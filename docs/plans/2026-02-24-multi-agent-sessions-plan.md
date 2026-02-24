# Multi-Agent Session & Project Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users browse, search, tag, and resume sessions for Codex, Gemini, and Aider alongside Claude Code.

**Architecture:** Add `agent_type` column to existing sessions/projects tables. Write one parser per agent that reads its native disk format and maps into the shared `upsertProject`/`upsertSession` shape. Update agents.ts resume flags, terminal server spawn logic, watcher, and session UI with agent-type filtering.

**Tech Stack:** Next.js (App Router), SQLite (better-sqlite3), Node.js fs, TypeScript

**Design doc:** `docs/plans/2026-02-24-multi-agent-sessions-design.md`

---

### Task 1: DB Schema — add `agent_type` columns

**Files:**
- Modify: `src/lib/db/schema.ts:119-136` (addCol migration section)

**Step 1: Add migration columns**

In `schema.ts`, after the existing `addCol` calls (around line 136), add:

```typescript
  // Multi-agent support: add agent_type to sessions and projects
  addCol('sessions', 'agent_type', "TEXT DEFAULT 'claude'");
  addCol('projects', 'agent_type', "TEXT DEFAULT 'claude'");
  addCol('projects', 'agent_path', 'TEXT');

  // Copy claude_path -> agent_path for existing rows that don't have it yet
  try { db.exec("UPDATE projects SET agent_path = claude_path WHERE agent_path IS NULL AND claude_path IS NOT NULL"); } catch { /* */ }

  // Index for filtering by agent type
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_agent_type ON sessions(agent_type)'); } catch { /* */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_agent_type ON projects(agent_type)'); } catch { /* */ }
```

**Step 2: Verify by running dev server**

Run: `npm run dev`
Expected: Server starts without errors. Existing sessions still appear (defaulted to `agent_type='claude'`).

**Step 3: Commit**

```
feat: add agent_type columns to sessions and projects tables
```

---

### Task 2: Update queries and types for agent_type

**Files:**
- Modify: `src/lib/db/queries.ts:7-14` (upsertProject), `src/lib/db/queries.ts:31-61` (upsertSession), `src/lib/db/queries.ts:63-73` (SessionQueryParams), `src/lib/db/queries.ts:75-161` (getSessions)
- Modify: `src/types/claude.ts:135-142` (Project), `src/types/claude.ts:144-164` (SessionWithMeta)

**Step 1: Update types**

In `src/types/claude.ts`, add `agentType` to `Project` (after line 139) and `SessionWithMeta` (after line 163):

```typescript
// Project — add agentType field
export interface Project {
  id: string;
  name: string;
  path: string;
  claudePath: string;
  agentType: string;
  sessionCount: number;
  lastActivity: string;
}

// SessionWithMeta — add agentType field
export interface SessionWithMeta {
  // ... existing fields ...
  nodeId?: string;
  nodeName?: string;
  agentType: string;
}
```

**Step 2: Update upsertProject**

In `src/lib/db/queries.ts`, modify `upsertProject` (line 7) to accept and store `agentType`:

```typescript
export function upsertProject(project: { id: string; name: string; path: string; claudePath: string; agentType?: string }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO projects (id, name, path, claude_path, agent_path, agent_type)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path, claude_path=excluded.claude_path, agent_path=excluded.agent_path, agent_type=excluded.agent_type
  `).run(project.id, project.name, project.path, project.claudePath, project.claudePath, project.agentType || 'claude');
}
```

**Step 3: Update upsertSession**

Modify `upsertSession` (line 31) to accept and store `agentType`:

```typescript
export function upsertSession(session: {
  id: string;
  sessionId: string;
  projectId: string;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  fullPath: string;
  agentType?: string;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, session_id, project_id, first_prompt, summary, message_count, created, modified, git_branch, project_path, full_path, agent_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      first_prompt=excluded.first_prompt,
      summary=excluded.summary,
      message_count=excluded.message_count,
      modified=excluded.modified,
      git_branch=excluded.git_branch,
      full_path=excluded.full_path,
      agent_type=excluded.agent_type
  `).run(
    session.id, session.sessionId, session.projectId,
    session.firstPrompt, session.summary, session.messageCount,
    session.created, session.modified, session.gitBranch,
    session.projectPath, session.fullPath, session.agentType || 'claude'
  );
}
```

**Step 4: Add agentType to SessionQueryParams and getSessions**

In `SessionQueryParams` (line 63), add:
```typescript
agentType?: string;
```

In `getSessions` (around line 112), add the filter clause after the `search` block:
```typescript
  if (params.agentType) {
    where.push('s.agent_type = ?');
    queryParams.push(params.agentType);
  }
```

In the SELECT statement (line 128), add `s.agent_type as agentType` to the column list.

Also add `s.agent_type as agentType` to the SELECT in `getSessionById` (line 166), `getWorkspaceSessions` (line 332), and `getAllProjects` (line 18 — add `p.agent_type as agentType`).

**Step 5: Commit**

```
feat: add agentType to queries, types, and session filtering
```

---

### Task 3: Expand getUserPaths with agent directories

**Files:**
- Modify: `src/lib/config.ts:42-49` (getUserPaths return)

**Step 1: Add agent paths to return object**

In `getUserPaths()`, expand the return object (line 42):

```typescript
  return {
    claudeDir: path.join(homeDir, '.claude'),
    claudeProjectsDir: path.join(homeDir, '.claude', 'projects'),
    statsPath: path.join(homeDir, '.claude', 'stats-cache.json'),
    codexDir: path.join(homeDir, '.codex'),
    codexSessionsDir: path.join(homeDir, '.codex', 'sessions'),
    geminiDir: path.join(homeDir, '.gemini'),
    geminiChatsBaseDir: path.join(homeDir, '.gemini', 'tmp'),
    geminiProjectsRegistry: path.join(homeDir, '.gemini', 'projects.json'),
    spacesDir,
    dbPath: path.join(spacesDir, 'spaces.db'),
    configPath: path.join(spacesDir, 'config.json'),
  };
```

**Step 2: Commit**

```
feat: add Codex and Gemini paths to getUserPaths
```

---

### Task 4: Codex parser

**Files:**
- Create: `src/lib/codex/parser.ts`

**Step 1: Write the parser**

The Codex parser scans `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. The first JSONL line is a `SessionMeta` item containing `id` (UUID), `cwd`, `timestamp`. Subsequent lines contain conversation events.

```typescript
import fs from 'fs';
import path from 'path';

interface CodexSessionMeta {
  id: string;
  cwd: string;
  timestamp: string;
  firstPrompt: string;
  messageCount: number;
  modified: string;
}

/**
 * Scan ~/.codex/sessions/ for rollout files and extract metadata.
 */
export function scanCodexSessions(sessionsDir: string): CodexSessionMeta[] {
  const results: CodexSessionMeta[] = [];

  if (!fs.existsSync(sessionsDir)) return results;

  // Walk YYYY/MM/DD structure
  for (const year of safeReaddir(sessionsDir)) {
    const yearPath = path.join(sessionsDir, year);
    if (!isDir(yearPath)) continue;
    for (const month of safeReaddir(yearPath)) {
      const monthPath = path.join(yearPath, month);
      if (!isDir(monthPath)) continue;
      for (const day of safeReaddir(monthPath)) {
        const dayPath = path.join(monthPath, day);
        if (!isDir(dayPath)) continue;
        for (const file of safeReaddir(dayPath)) {
          if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) continue;
          const filePath = path.join(dayPath, file);
          const meta = parseRolloutMeta(filePath);
          if (meta) results.push(meta);
        }
      }
    }
  }

  return results;
}

function parseRolloutMeta(filePath: string): CodexSessionMeta | null {
  try {
    // Read first ~8KB to get SessionMeta and first user message
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);

    const chunk = buf.toString('utf-8', 0, bytesRead);
    const lines = chunk.split('\n').filter(l => l.trim());

    let id = '';
    let cwd = '';
    let timestamp = '';
    let firstPrompt = '';
    let messageCount = 0;

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const item = entry.item || entry;

        // SessionMeta item
        if (item.type === 'session_meta' || item.id) {
          if (!id && item.id) {
            id = item.id;
            cwd = item.cwd || '';
            timestamp = entry.timestamp || item.timestamp || '';
          }
        }

        // Count events that look like messages
        if (entry.item?.type === 'event' || entry.type === 'event') {
          messageCount++;
        }

        // Extract first user message
        if (!firstPrompt) {
          const payload = entry.item?.payload || entry.payload;
          if (payload?.type === 'user_message' || payload?.type === 'UserMessage') {
            firstPrompt = (typeof payload.content === 'string'
              ? payload.content
              : JSON.stringify(payload.content)
            ).slice(0, 500);
          }
        }
      } catch { /* skip unparseable lines */ }
    }

    if (!id) {
      // Fallback: extract session ID from filename (rollout-<timestamp>-<uuid>.jsonl)
      const match = filePath.match(/rollout-[^-]+-(.+)\.jsonl$/);
      if (match) id = match[1];
      else return null;
    }

    const stat = fs.statSync(filePath);

    return {
      id,
      cwd,
      timestamp: timestamp || stat.birthtime.toISOString(),
      firstPrompt,
      messageCount,
      modified: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

function safeReaddir(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
```

**Step 2: Commit**

```
feat: add Codex session parser
```

---

### Task 5: Gemini parser

**Files:**
- Create: `src/lib/gemini/parser.ts`

**Step 1: Write the parser**

Gemini stores sessions at `~/.gemini/tmp/<project-slug>/chats/session-<timestamp>-<id>.json`. Each is a JSON file with `sessionId`, `startTime`, `lastUpdated`, `messages[]`, and optional `summary`.

```typescript
import fs from 'fs';
import path from 'path';

interface GeminiSessionMeta {
  sessionId: string;
  projectSlug: string;
  projectPath: string;
  startTime: string;
  lastUpdated: string;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  fullPath: string;
}

/**
 * Scan ~/.gemini/tmp/*/chats/ for session files.
 * Optionally reads projects.json to map slugs to real project paths.
 */
export function scanGeminiSessions(geminiChatsBaseDir: string, projectsRegistryPath: string): GeminiSessionMeta[] {
  const results: GeminiSessionMeta[] = [];

  if (!fs.existsSync(geminiChatsBaseDir)) return results;

  // Load project registry (slug -> path mapping)
  const projectMap = loadProjectRegistry(projectsRegistryPath);

  for (const slug of safeReaddir(geminiChatsBaseDir)) {
    const slugDir = path.join(geminiChatsBaseDir, slug);
    if (!isDir(slugDir)) continue;

    const chatsDir = path.join(slugDir, 'chats');
    if (!fs.existsSync(chatsDir)) continue;

    for (const file of safeReaddir(chatsDir)) {
      if (!file.startsWith('session-') || !file.endsWith('.json')) continue;
      const filePath = path.join(chatsDir, file);
      const meta = parseGeminiSession(filePath, slug, projectMap);
      if (meta) results.push(meta);
    }
  }

  return results;
}

function parseGeminiSession(
  filePath: string,
  projectSlug: string,
  projectMap: Map<string, string>
): GeminiSessionMeta | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    const sessionId = data.sessionId || '';
    if (!sessionId) return null;

    // Extract first user message
    let firstPrompt = '';
    const messages = data.messages || [];
    for (const msg of messages) {
      if (msg.type === 'user' && !firstPrompt) {
        if (typeof msg.content === 'string') {
          firstPrompt = msg.content.slice(0, 500);
        } else if (msg.content?.parts) {
          // Gemini uses parts array with text fields
          const textParts = msg.content.parts
            .filter((p: any) => typeof p === 'string' || p.text)
            .map((p: any) => typeof p === 'string' ? p : p.text);
          firstPrompt = textParts.join(' ').slice(0, 500);
        }
        break;
      }
    }

    return {
      sessionId,
      projectSlug,
      projectPath: projectMap.get(projectSlug) || '',
      startTime: data.startTime || '',
      lastUpdated: data.lastUpdated || '',
      firstPrompt,
      summary: data.summary || '',
      messageCount: messages.length,
      fullPath: filePath,
    };
  } catch {
    return null;
  }
}

function loadProjectRegistry(registryPath: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!registryPath || !fs.existsSync(registryPath)) return map;
  try {
    const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    // projects.json maps {projectPath: slugId} or an array of entries
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (entry.slug && entry.path) map.set(entry.slug, entry.path);
        if (entry.id && entry.path) map.set(entry.id, entry.path);
      }
    } else if (typeof data === 'object') {
      for (const [projectPath, slug] of Object.entries(data)) {
        if (typeof slug === 'string') map.set(slug, projectPath);
      }
    }
  } catch { /* ignore */ }
  return map;
}

function safeReaddir(dir: string): string[] {
  try { return fs.readdirSync(dir); } catch { return []; }
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
```

**Step 2: Commit**

```
feat: add Gemini session parser
```

---

### Task 6: Aider parser

**Files:**
- Create: `src/lib/aider/parser.ts`

**Step 1: Write the parser**

Aider stores a single `.aider.chat.history.md` per project directory. One "session" entry per project. Count `#### ` markers for message count, extract first one as firstPrompt.

```typescript
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

interface AiderSessionMeta {
  projectPath: string;
  firstPrompt: string;
  messageCount: number;
  modified: string;
  created: string;
}

/**
 * Scan a list of project directories for .aider.chat.history.md files.
 */
export function scanAiderSessions(projectDirs: string[]): AiderSessionMeta[] {
  const results: AiderSessionMeta[] = [];
  const seen = new Set<string>();

  for (const dir of projectDirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);

    const historyFile = path.join(dir, '.aider.chat.history.md');
    if (!fs.existsSync(historyFile)) continue;

    const meta = parseAiderHistory(historyFile, dir);
    if (meta) results.push(meta);
  }

  return results;
}

function parseAiderHistory(filePath: string, projectDir: string): AiderSessionMeta | null {
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let firstPrompt = '';
    let messageCount = 0;

    for (const line of lines) {
      if (line.startsWith('#### ')) {
        messageCount++;
        if (!firstPrompt) {
          firstPrompt = line.slice(5).trim().slice(0, 500);
        }
      }
    }

    if (messageCount === 0) return null;

    return {
      projectPath: projectDir,
      firstPrompt,
      messageCount,
      modified: stat.mtime.toISOString(),
      created: stat.birthtime.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Generate a deterministic session ID from a project path.
 * Aider has no session IDs, so we hash the path.
 */
export function aiderSessionId(projectPath: string): string {
  return 'aider-' + crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 16);
}

/**
 * Generate a deterministic project ID from a project path for Aider.
 */
export function aiderProjectId(projectPath: string): string {
  return 'aider-proj-' + crypto.createHash('sha256').update(projectPath).digest('hex').slice(0, 12);
}
```

**Step 2: Commit**

```
feat: add Aider session parser
```

---

### Task 7: Update indexer to scan all agents

**Files:**
- Modify: `src/lib/sync/indexer.ts`

**Step 1: Refactor fullSync into per-agent scanners**

Replace the existing `fullSync()` with a version that calls four sub-scanners. Keep the existing Claude logic as `syncClaude()`, then add `syncCodex()`, `syncGemini()`, `syncAider()`.

Add these imports at top:
```typescript
import { scanCodexSessions } from '../codex/parser';
import { scanGeminiSessions } from '../gemini/parser';
import { scanAiderSessions, aiderSessionId, aiderProjectId } from '../aider/parser';
import { readConfig } from '../config';
```

Rewrite `fullSync()` to:
```typescript
export async function fullSync(): Promise<{ projects: number; sessions: number }> {
  const username = getCurrentUser();
  const paths = getUserPaths(username);

  const db = getDb();
  let projectCount = 0;
  let sessionCount = 0;

  const insertMany = db.transaction(() => {
    const claude = syncClaude(paths.claudeProjectsDir);
    projectCount += claude.projects;
    sessionCount += claude.sessions;

    const codex = syncCodex(paths.codexSessionsDir);
    projectCount += codex.projects;
    sessionCount += codex.sessions;

    const gemini = syncGemini(paths.geminiChatsBaseDir, paths.geminiProjectsRegistry);
    projectCount += gemini.projects;
    sessionCount += gemini.sessions;

    // Aider: scan devDirectories + known project paths
    const config = readConfig(username);
    const knownProjectPaths = db.prepare(
      "SELECT DISTINCT project_path FROM sessions WHERE project_path != '' AND project_path IS NOT NULL"
    ).all().map((r: any) => r.project_path);
    const aiderDirs = [...new Set([...(config.devDirectories || []), ...knownProjectPaths])];
    const aider = syncAider(aiderDirs);
    projectCount += aider.projects;
    sessionCount += aider.sessions;
  });

  insertMany();
  return { projects: projectCount, sessions: sessionCount };
}
```

Extract existing Claude logic into `syncClaude(projectsDir)` that returns `{ projects, sessions }`. Same signature for the other three:

- `syncClaude(projectsDir)` — existing logic, passes `agentType: 'claude'` to upserts
- `syncCodex(sessionsDir)` — calls `scanCodexSessions`, derives projects from `cwd`, upserts with `agentType: 'codex'`
- `syncGemini(chatsBaseDir, registryPath)` — calls `scanGeminiSessions`, upserts with `agentType: 'gemini'`
- `syncAider(projectDirs)` — calls `scanAiderSessions`, uses `aiderProjectId`/`aiderSessionId` for IDs, upserts with `agentType: 'aider'`

Keep `enrichMissingSessions`, `buildFtsIndex`, `isSyncNeeded`, and `decodeProjectName` unchanged.

**Step 2: Verify sync runs**

Run: `npm run dev` and visit the sessions page.
Expected: Existing Claude sessions still appear. If Codex/Gemini/Aider directories exist, their sessions also appear.

**Step 3: Commit**

```
feat: update indexer to scan Codex, Gemini, and Aider sessions
```

---

### Task 8: Update watcher to watch all agent directories

**Files:**
- Modify: `src/lib/sync/watcher.ts`

**Step 1: Watch multiple directories**

Update `initWatcher` to watch Codex and Gemini directories too. Aider is project-local so we skip it — it syncs on fullSync.

Replace the existing single-directory watcher with a loop over agent directories:

```typescript
import os from 'os';
import fs from 'fs';
import { getUserPaths } from '../config';
import { fullSync } from './indexer';
import { sseManager } from '../events/sse';

let watcherInitialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function initWatcher() {
  if (watcherInitialized) return;
  watcherInitialized = true;

  const processUser = os.userInfo().username;
  const paths = getUserPaths(processUser);

  const watchDirs: { dir: string; filter: (f: string) => boolean }[] = [
    {
      dir: paths.claudeProjectsDir,
      filter: (f) => f.endsWith('.jsonl') || f.endsWith('sessions-index.json'),
    },
    {
      dir: paths.codexSessionsDir,
      filter: (f) => f.endsWith('.jsonl'),
    },
    {
      dir: paths.geminiChatsBaseDir,
      filter: (f) => f.endsWith('.json') && f.includes('session-'),
    },
  ];

  try {
    const chokidar = await import('chokidar');

    for (const { dir, filter } of watchDirs) {
      if (!fs.existsSync(dir)) continue;

      const watcher = chokidar.watch(dir, {
        ignoreInitial: true,
        depth: 5,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      });

      watcher.on('all', (event: string, filePath: string) => {
        if (!filter(filePath)) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          try {
            await fullSync();
            sseManager.broadcast('sync', { type: event, file: filePath, timestamp: Date.now() });
          } catch (err) {
            console.error('[spaces] Watcher sync error:', err);
          }
        }, 1000);
      });

      console.log('[spaces] File watcher started on', dir);
    }
  } catch (err) {
    console.error('[spaces] Failed to start file watcher:', err);
  }
}
```

**Step 2: Commit**

```
feat: watch Codex and Gemini directories for live session updates
```

---

### Task 9: Update agents.ts with resume flags

**Files:**
- Modify: `src/lib/agents.ts`

**Step 1: Update Codex and Gemini entries**

```typescript
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    resumeFlag: 'resume',          // subcommand: codex resume <id>
    supportsResume: true,
    color: '#10b981',
    description: 'OpenAI Codex CLI',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    resumeFlag: '--resume',        // flag: gemini --resume <id>
    supportsResume: true,
    color: '#3b82f6',
    description: 'Google Gemini CLI',
  },
```

**Step 2: Commit**

```
feat: enable resume support for Codex and Gemini agents
```

---

### Task 10: Update terminal server spawn logic

**Files:**
- Modify: `bin/terminal-server.js:309-316` (AGENTS object)
- Modify: `bin/terminal-server.js:537-583` (resume spawn logic)

**Step 1: Update AGENTS object**

```javascript
const AGENTS = {
  shell:  { command: '',       resumeFlag: '',         resumeStyle: '' },
  claude: { command: 'claude', resumeFlag: '--resume', resumeStyle: 'flag' },
  codex:  { command: 'codex',  resumeFlag: 'resume',   resumeStyle: 'subcommand' },
  gemini: { command: 'gemini', resumeFlag: '--resume', resumeStyle: 'flag' },
  aider:  { command: 'aider',  resumeFlag: '',         resumeStyle: '' },
  custom: { command: '',       resumeFlag: '',         resumeStyle: '' },
};
```

**Step 2: Update resume spawn logic**

Replace the Claude-specific resume block (lines 537-583) with agent-generic logic. Keep the Claude `findSessionCwd` special case. For other agents, use the same delay pattern:

- Claude: `claude --resume <sessionId>` (with CWD lookup)
- Codex: `codex resume <sessionId>` (subcommand)
- Gemini: `gemini --resume <sessionId>` (flag)

See design doc for full spawn logic.

**Step 3: Commit**

```
feat: terminal server supports Codex and Gemini session resume
```

---

### Task 11: Update session API to accept agentType filter

**Files:**
- Modify: `src/app/api/sessions/route.ts`

**Step 1: Add agentType param**

In the GET handler (line 13), add `agentType` to params:

```typescript
    const params = {
      // ... existing params ...
      agentType: searchParams.get('agentType') || undefined,
    };
```

**Step 2: Commit**

```
feat: session API accepts agentType filter parameter
```

---

### Task 12: Add agent-type filter to session filters UI

**Files:**
- Modify: `src/components/sessions/session-filters.tsx`

**Step 1: Add agentType prop and filter chips**

Add `agentType` / `onAgentTypeChange` props to `SessionFiltersProps`. Import `AGENT_TYPES` from `@/lib/agents`.

Add a row of colored filter chips (All, Claude, Codex, Gemini, Aider) above the existing search/sort row. Each chip shows a colored dot matching the agent's color and highlights when active.

**Step 2: Wire up in parent component**

Find the parent page that renders `<SessionFilters>` and add `agentType` state. Pass it to `<SessionFilters>` and include `agentType` in the session fetch params.

**Step 3: Commit**

```
feat: add agent-type filter chips to session list
```

---

### Task 13: Add agent badge to session list rows

**Files:**
- Modify: `src/components/sessions/session-list.tsx:147-148`

**Step 1: Add agent badge**

Import `AGENT_TYPES` from `@/lib/agents`. In the `SessionRow` component, after the project name span (line 148), add a small colored badge for non-Claude sessions:

```typescript
{session.agentType && session.agentType !== 'claude' && (
  <span
    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium"
    style={{
      backgroundColor: `${AGENT_TYPES[session.agentType]?.color || '#71717a'}15`,
      color: AGENT_TYPES[session.agentType]?.color || '#71717a',
    }}
  >
    {AGENT_TYPES[session.agentType]?.name || session.agentType}
  </span>
)}
```

**Step 2: Commit**

```
feat: show agent badge on non-Claude session rows
```

---

### Task 14: Update resume picker for Codex and Gemini

**Files:**
- Modify: `src/app/(desktop)/terminal/page.tsx`

**Step 1: Filter sessions by agent type in resume picker**

Find the `useEffect` that loads sessions for the resume picker (around line 161-176). Add `agentType` to the query params:

```typescript
sp.set('agentType', newAgentType);
```

This ensures the resume picker for Codex shows only Codex sessions, Gemini shows only Gemini sessions, etc.

**Step 2: Commit**

```
feat: resume picker filters sessions by selected agent type
```

---

### Task 15: Update hooks to pass agentType

**Files:**
- Modify: `src/hooks/use-sessions.ts`

**Step 1: Add agentType to SessionsParams and query key**

In the `SessionsParams` interface, add:
```typescript
agentType?: string;
```

In `useSessions`, add it to the URL params:
```typescript
if (params.agentType) sp.set('agentType', params.agentType);
```

And include it in the React Query key so changing agent type triggers a refetch.

**Step 2: Commit**

```
feat: session hooks support agentType filtering
```

---

### Task 16: Integration verification

**Step 1: Run dev server and verify**

Run: `npm run dev`

Check:
- Sessions page loads without errors
- Agent filter chips appear (All, Claude, Codex, Gemini, Aider)
- Clicking a filter shows only that agent's sessions
- Claude sessions still have all existing functionality (star, tag, search, resume)
- If Codex/Gemini directories exist on the machine, their sessions appear
- Resume picker for Codex/Gemini shows only that agent's sessions
- Terminal pane creation with Codex/Gemini resume mode works

**Step 2: Final commit**

```
feat: multi-agent session support for Codex, Gemini, and Aider
```
