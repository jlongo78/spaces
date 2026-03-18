# Cortex Lobes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add knowledge compartmentalization ("lobes") to Cortex so workspaces control which knowledge sources they can pull from — open by default within a user, closed by default across users, with privacy, exclusions, and cross-user sharing.

**Architecture:** A new `src/lib/cortex/lobes/` module containing lobe config types, a resolver that computes accessible lobes for a workspace, and sharing logic. The ContextEngine's `computeSourceWeights()` is modified to use the lobe resolver instead of hardcoded layers. Lobe config is stored as a JSON column on the workspaces table. Cross-user shares live in the entity graph's SQLite database.

**Tech Stack:** TypeScript, better-sqlite3 (entity graph DB), vitest

**Spec:** `docs/superpowers/specs/2026-03-16-cortex-lobes-design.md`

---

## File Structure

```
New files:
├── src/lib/cortex/lobes/config.ts         — LobeConfig types and defaults
├── src/lib/cortex/lobes/resolver.ts       — Resolve accessible lobes for a workspace
├── src/lib/cortex/lobes/shares.ts         — Cross-user sharing (lobe_shares table)
├── src/lib/cortex/lobes/index.ts          — Barrel export
├── src/app/api/cortex/lobes/route.ts      — List lobes, update config
├── src/app/api/cortex/lobes/share/route.ts — Share management
├── src/components/cortex/lobe-settings.tsx — UI component for workspace settings

Test files:
├── tests/lib/cortex/lobes/resolver.test.ts
├── tests/lib/cortex/lobes/shares.test.ts

Modified files:
├── src/lib/db/schema.ts                   — Add lobe_config column to workspaces
├── src/lib/cortex/retrieval/context-engine.ts — Use lobe resolver for search scopes
```

---

## Chunk 1: Types, DB Migration, and Lobe Resolver

### Task 1: Lobe config types and defaults

**Files:**
- Create: `src/lib/cortex/lobes/config.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/lib/cortex/lobes/config.ts

export interface LobeSubscription {
  type: 'workspace' | 'user' | 'tag' | 'team' | 'department' | 'organization';
  id: string;       // workspace ID, user entity ID, tag name, etc.
  label: string;    // display name
}

export interface LobeConfig {
  isPrivate: boolean;
  excludedFrom: number[];        // workspace IDs blocked from accessing this lobe
  subscriptions: LobeSubscription[];
  tags: string[];
}

export const DEFAULT_LOBE_CONFIG: LobeConfig = {
  isPrivate: false,
  excludedFrom: [],
  subscriptions: [],
  tags: [],
};

export function parseLobeConfig(raw: string | null | undefined): LobeConfig {
  if (!raw) return { ...DEFAULT_LOBE_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return {
      isPrivate: parsed.isPrivate ?? false,
      excludedFrom: Array.isArray(parsed.excludedFrom) ? parsed.excludedFrom : [],
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch {
    return { ...DEFAULT_LOBE_CONFIG };
  }
}

export function serializeLobeConfig(config: LobeConfig): string {
  return JSON.stringify(config);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/cortex/lobes/config.ts
git commit -m "feat(cortex): add lobe config types and defaults"
```

---

### Task 2: Database migration — add lobe_config column

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: Read schema.ts to find the migration section**

Read `src/lib/db/schema.ts`. Find the section with `addCol` calls (around line 120+). Add:

```typescript
addCol('workspaces', 'lobe_config', "TEXT DEFAULT '{}'");
```

This adds a JSON text column to the existing workspaces table with an empty config default.

- [ ] **Step 2: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(cortex): add lobe_config column to workspaces table"
```

---

### Task 3: Lobe resolver — compute accessible lobes for a workspace

**Files:**
- Create: `src/lib/cortex/lobes/resolver.ts`
- Create: `tests/lib/cortex/lobes/resolver.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/lobes/resolver.test.ts
import { describe, it, expect } from 'vitest';
import { resolveLobes } from '@/lib/cortex/lobes/resolver';
import type { LobeConfig } from '@/lib/cortex/lobes/config';
import { DEFAULT_LOBE_CONFIG } from '@/lib/cortex/lobes/config';

// Minimal workspace shape for testing
interface TestWorkspace {
  id: number;
  name: string;
  lobeConfig: LobeConfig;
}

describe('resolveLobes', () => {
  const workspaces: TestWorkspace[] = [
    { id: 1, name: 'Auth Service', lobeConfig: DEFAULT_LOBE_CONFIG },
    { id: 2, name: 'Frontend', lobeConfig: DEFAULT_LOBE_CONFIG },
    { id: 3, name: 'Private Project', lobeConfig: { ...DEFAULT_LOBE_CONFIG, isPrivate: true } },
    { id: 4, name: 'Excluded', lobeConfig: { ...DEFAULT_LOBE_CONFIG, excludedFrom: [1] } },
  ];

  it('includes own workspace lobe', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: workspaces });
    const keys = lobes.map(l => l.layerKey);
    expect(keys).toContain('workspace/1');
  });

  it('includes personal lobe', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: workspaces });
    const keys = lobes.map(l => l.layerKey);
    expect(keys).toContain('personal');
  });

  it('includes other non-private workspaces by default', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: workspaces });
    const keys = lobes.map(l => l.layerKey);
    expect(keys).toContain('workspace/2');
  });

  it('excludes private workspaces', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: workspaces });
    const keys = lobes.map(l => l.layerKey);
    expect(keys).not.toContain('workspace/3');
  });

  it('excludes workspaces that exclude the requester', () => {
    // Workspace 4 excludes workspace 1
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: workspaces });
    const keys = lobes.map(l => l.layerKey);
    expect(keys).not.toContain('workspace/4');
  });

  it('includes team lobe by default', () => {
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: workspaces });
    const keys = lobes.map(l => l.layerKey);
    expect(keys).toContain('team');
  });

  it('includes explicit subscriptions', () => {
    const ws: TestWorkspace[] = [
      {
        id: 1, name: 'Main',
        lobeConfig: {
          ...DEFAULT_LOBE_CONFIG,
          subscriptions: [{ type: 'tag', id: 'infrastructure', label: 'Infrastructure' }],
        },
      },
    ];
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: ws });
    const tags = lobes.filter(l => l.type === 'tag');
    expect(tags).toHaveLength(1);
    expect(tags[0].id).toBe('infrastructure');
  });

  it('assigns lower weight to subscribed lobes vs inherited', () => {
    const ws: TestWorkspace[] = [
      {
        id: 1, name: 'Main',
        lobeConfig: {
          ...DEFAULT_LOBE_CONFIG,
          subscriptions: [{ type: 'workspace', id: '99', label: 'Remote' }],
        },
      },
    ];
    const lobes = resolveLobes({ workspaceId: 1, allWorkspaces: ws });
    const own = lobes.find(l => l.layerKey === 'workspace/1');
    const subscribed = lobes.find(l => l.layerKey === 'workspace/99');
    expect(own!.baseWeight).toBeGreaterThan(subscribed!.baseWeight);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/cortex/lobes/resolver.test.ts`

- [ ] **Step 3: Implement lobe resolver**

```typescript
// src/lib/cortex/lobes/resolver.ts
import type { LobeConfig, LobeSubscription } from './config';

export interface ResolvedLobe {
  layerKey: string;      // LanceDB storage path (e.g., 'workspace/42', 'personal', 'team')
  label: string;         // display name
  type: 'own' | 'personal' | 'workspace' | 'team' | 'department' | 'organization' | 'tag' | 'user';
  id: string;            // source identifier
  baseWeight: number;    // base retrieval weight (before graph proximity)
  inherited: boolean;    // true if auto-inherited, false if explicitly subscribed
}

interface WorkspaceInfo {
  id: number;
  name: string;
  lobeConfig: LobeConfig;
}

interface ResolveInput {
  workspaceId: number;
  allWorkspaces: WorkspaceInfo[];
  userId?: string;       // for personal lobe entity ID
}

/**
 * Resolve the list of accessible knowledge lobes for a workspace.
 *
 * Default behavior: own workspace + personal + all non-private sibling workspaces + team + org.
 * Respects privacy, exclusions, and explicit subscriptions.
 */
export function resolveLobes(input: ResolveInput): ResolvedLobe[] {
  const { workspaceId, allWorkspaces, userId } = input;
  const lobes: ResolvedLobe[] = [];

  const thisWs = allWorkspaces.find(w => w.id === workspaceId);
  const thisConfig = thisWs?.lobeConfig;

  // 1. Own workspace lobe (always included)
  lobes.push({
    layerKey: `workspace/${workspaceId}`,
    label: thisWs?.name ?? 'This workspace',
    type: 'own',
    id: String(workspaceId),
    baseWeight: 1.0,
    inherited: true,
  });

  // 2. Personal lobe (always included)
  lobes.push({
    layerKey: 'personal',
    label: 'Personal',
    type: 'personal',
    id: userId ?? 'personal',
    baseWeight: 0.9,
    inherited: true,
  });

  // 3. Other workspaces (same user) — included unless private or excluded
  for (const ws of allWorkspaces) {
    if (ws.id === workspaceId) continue;

    // Skip if the other workspace is private
    if (ws.lobeConfig.isPrivate) continue;

    // Skip if the other workspace excludes this workspace
    if (ws.lobeConfig.excludedFrom.includes(workspaceId)) continue;

    lobes.push({
      layerKey: `workspace/${ws.id}`,
      label: ws.name,
      type: 'workspace',
      id: String(ws.id),
      baseWeight: 0.6,
      inherited: true,
    });
  }

  // 4. Team / org inherited lobes
  lobes.push({
    layerKey: 'team',
    label: 'Team',
    type: 'team',
    id: 'team',
    baseWeight: 0.5,
    inherited: true,
  });

  // 5. Explicit subscriptions from this workspace's config
  if (thisConfig?.subscriptions) {
    for (const sub of thisConfig.subscriptions) {
      // Avoid duplicates
      const layerKey = sub.type === 'workspace' ? `workspace/${sub.id}`
        : sub.type === 'tag' ? `tag/${sub.id}`
        : sub.type === 'team' ? `team/${sub.id}`
        : sub.type === 'user' ? `user/${sub.id}`
        : sub.id;

      if (lobes.some(l => l.layerKey === layerKey)) continue;

      lobes.push({
        layerKey,
        label: sub.label,
        type: sub.type as ResolvedLobe['type'],
        id: sub.id,
        baseWeight: 0.4,  // subscribed = lower weight than inherited
        inherited: false,
      });
    }
  }

  return lobes;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/lobes/resolver.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/lobes/resolver.ts tests/lib/cortex/lobes/resolver.test.ts
git commit -m "feat(cortex): add lobe resolver for workspace knowledge scoping"
```

---

## Chunk 2: Cross-User Sharing and Context Engine Integration

### Task 4: Cross-user lobe sharing

**Files:**
- Create: `src/lib/cortex/lobes/shares.ts`
- Create: `tests/lib/cortex/lobes/shares.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/lobes/shares.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { LobeShareStore } from '@/lib/cortex/lobes/shares';

describe('LobeShareStore', () => {
  let tmpDir: string;
  let store: LobeShareStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobe-shares-'));
    const db = new Database(path.join(tmpDir, 'test.db'));
    store = new LobeShareStore(db);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a share', () => {
    const share = store.share({
      ownerUserId: 'person-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'Auth Service',
      sharedWithUserId: 'person-bob',
    });
    expect(share.id).toBeDefined();
    expect(share.accepted).toBe(false);
  });

  it('accepts a share', () => {
    const share = store.share({
      ownerUserId: 'person-alice',
      ownerWorkspaceId: 1,
      ownerLobeName: 'Auth Service',
      sharedWithUserId: 'person-bob',
    });
    store.accept(share.id);
    const updated = store.getShare(share.id);
    expect(updated!.accepted).toBe(true);
  });

  it('lists incoming shares for a user', () => {
    store.share({ ownerUserId: 'person-alice', ownerWorkspaceId: 1, ownerLobeName: 'WS1', sharedWithUserId: 'person-bob' });
    store.share({ ownerUserId: 'person-charlie', ownerWorkspaceId: 2, ownerLobeName: 'WS2', sharedWithUserId: 'person-bob' });
    const incoming = store.listIncoming('person-bob');
    expect(incoming).toHaveLength(2);
  });

  it('lists outgoing shares for a user', () => {
    store.share({ ownerUserId: 'person-alice', ownerWorkspaceId: 1, ownerLobeName: 'WS1', sharedWithUserId: 'person-bob' });
    const outgoing = store.listOutgoing('person-alice');
    expect(outgoing).toHaveLength(1);
  });

  it('revokes a share', () => {
    const share = store.share({ ownerUserId: 'person-alice', ownerWorkspaceId: 1, ownerLobeName: 'WS1', sharedWithUserId: 'person-bob' });
    store.revoke(share.id);
    expect(store.getShare(share.id)).toBeNull();
  });

  it('prevents duplicate shares', () => {
    store.share({ ownerUserId: 'person-alice', ownerWorkspaceId: 1, ownerLobeName: 'WS1', sharedWithUserId: 'person-bob' });
    store.share({ ownerUserId: 'person-alice', ownerWorkspaceId: 1, ownerLobeName: 'WS1', sharedWithUserId: 'person-bob' });
    const incoming = store.listIncoming('person-bob');
    expect(incoming).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement share store**

```typescript
// src/lib/cortex/lobes/shares.ts
import type Database from 'better-sqlite3';

export interface LobeShare {
  id: string;
  ownerUserId: string;
  ownerWorkspaceId: number;
  ownerLobeName: string;
  sharedWithUserId: string;
  accepted: boolean;
  created: string;
}

interface ShareInput {
  ownerUserId: string;
  ownerWorkspaceId: number;
  ownerLobeName: string;
  sharedWithUserId: string;
}

export class LobeShareStore {
  private db: InstanceType<typeof Database>;

  constructor(db: InstanceType<typeof Database>) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lobe_shares (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        owner_workspace_id INTEGER NOT NULL,
        owner_lobe_name TEXT NOT NULL,
        shared_with_user_id TEXT NOT NULL,
        accepted INTEGER DEFAULT 0,
        created TEXT NOT NULL,
        UNIQUE(owner_user_id, owner_workspace_id, shared_with_user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_lobe_shares_recipient ON lobe_shares(shared_with_user_id);
      CREATE INDEX IF NOT EXISTS idx_lobe_shares_owner ON lobe_shares(owner_user_id);
    `);
  }

  share(input: ShareInput): LobeShare {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO lobe_shares (id, owner_user_id, owner_workspace_id, owner_lobe_name, shared_with_user_id, created)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_user_id, owner_workspace_id, shared_with_user_id) DO NOTHING
    `).run(id, input.ownerUserId, input.ownerWorkspaceId, input.ownerLobeName, input.sharedWithUserId, now);

    // Return existing if duplicate
    const existing = this.db.prepare(
      'SELECT * FROM lobe_shares WHERE owner_user_id = ? AND owner_workspace_id = ? AND shared_with_user_id = ?'
    ).get(input.ownerUserId, input.ownerWorkspaceId, input.sharedWithUserId) as any;

    return this.rowToShare(existing);
  }

  accept(id: string): void {
    this.db.prepare('UPDATE lobe_shares SET accepted = 1 WHERE id = ?').run(id);
  }

  revoke(id: string): void {
    this.db.prepare('DELETE FROM lobe_shares WHERE id = ?').run(id);
  }

  getShare(id: string): LobeShare | null {
    const row = this.db.prepare('SELECT * FROM lobe_shares WHERE id = ?').get(id) as any;
    return row ? this.rowToShare(row) : null;
  }

  listIncoming(userId: string): LobeShare[] {
    const rows = this.db.prepare(
      'SELECT * FROM lobe_shares WHERE shared_with_user_id = ? ORDER BY created DESC'
    ).all(userId) as any[];
    return rows.map(r => this.rowToShare(r));
  }

  listOutgoing(userId: string): LobeShare[] {
    const rows = this.db.prepare(
      'SELECT * FROM lobe_shares WHERE owner_user_id = ? ORDER BY created DESC'
    ).all(userId) as any[];
    return rows.map(r => this.rowToShare(r));
  }

  listAcceptedForUser(userId: string): LobeShare[] {
    const rows = this.db.prepare(
      'SELECT * FROM lobe_shares WHERE shared_with_user_id = ? AND accepted = 1'
    ).all(userId) as any[];
    return rows.map(r => this.rowToShare(r));
  }

  private rowToShare(row: any): LobeShare {
    return {
      id: row.id,
      ownerUserId: row.owner_user_id,
      ownerWorkspaceId: row.owner_workspace_id,
      ownerLobeName: row.owner_lobe_name,
      sharedWithUserId: row.shared_with_user_id,
      accepted: row.accepted === 1,
      created: row.created,
    };
  }
}
```

- [ ] **Step 3: Run tests, commit**

Run: `npx vitest run tests/lib/cortex/lobes/shares.test.ts`

```bash
git commit -m "feat(cortex): add cross-user lobe sharing with handshake"
```

---

### Task 5: Integrate lobe resolver with Context Assembly Engine

**Files:**
- Modify: `src/lib/cortex/retrieval/context-engine.ts`

- [ ] **Step 1: Read context-engine.ts**

Read the file. Find `computeSourceWeights()` — the private method that returns hardcoded layer definitions.

- [ ] **Step 2: Add optional lobe-aware scope computation**

Add to `ContextEngineDeps`:
```typescript
resolvedLobes?: ResolvedLobe[];  // pre-computed accessible lobes for this workspace
```

Import:
```typescript
import type { ResolvedLobe } from '../lobes/resolver';
```

Modify `computeSourceWeights()` to use resolved lobes when available:

```typescript
private computeSourceWeights(
  intent: IntentResult,
  workspaceId: number | null,
): SourceConfig[] {
  // If lobes are provided, use them instead of hardcoded layers
  if (this.deps.resolvedLobes && this.deps.resolvedLobes.length > 0) {
    return this.deps.resolvedLobes.map(lobe => {
      const graphProximity = lobe.baseWeight;  // lobes already have base weights

      const weight = computeScopeWeight({
        graphProximity,
        scopeLevel: lobe.type === 'personal' ? 'personal'
          : lobe.type === 'team' || lobe.type === 'department' ? 'team'
          : lobe.type === 'organization' ? 'organization'
          : 'team',
        intentBiases: intent.biases,
        authorityFactor: 1.0,
      });

      return {
        layerKey: lobe.layerKey,
        weight,
        limit: Math.max(3, Math.round(weight * 10)),
      };
    }).sort((a, b) => b.weight - a.weight);
  }

  // Fallback: hardcoded layers (backward compat when no lobe config)
  const layerDefs = [
    // ... existing code unchanged ...
  ];
  // ... rest of existing method unchanged ...
}
```

- [ ] **Step 3: Run existing context-engine tests to verify no regressions**

Run: `npx vitest run tests/lib/cortex/retrieval/context-engine.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/retrieval/context-engine.ts
git commit -m "feat(cortex): integrate lobe resolver into context assembly engine"
```

---

## Chunk 3: API Routes and UI

### Task 6: Lobe API endpoints

**Files:**
- Create: `src/app/api/cortex/lobes/route.ts`
- Create: `src/app/api/cortex/lobes/[id]/route.ts`
- Create: `src/app/api/cortex/lobes/share/route.ts`

- [ ] **Step 1: Create main lobes endpoint**

```typescript
// src/app/api/cortex/lobes/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseLobeConfig } from '@/lib/cortex/lobes/config';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const db = getDb();
    const workspaces = db.prepare(
      'SELECT id, name, color, lobe_config FROM workspaces ORDER BY name'
    ).all() as any[];

    const lobes = workspaces.map(ws => ({
      workspaceId: ws.id,
      name: ws.name,
      color: ws.color,
      config: parseLobeConfig(ws.lobe_config),
    }));

    return NextResponse.json({ lobes });
  });
}
```

- [ ] **Step 2: Create single workspace lobe config endpoint**

```typescript
// src/app/api/cortex/lobes/[id]/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseLobeConfig, serializeLobeConfig } from '@/lib/cortex/lobes/config';
import type { LobeConfig } from '@/lib/cortex/lobes/config';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const db = getDb();
    const ws = db.prepare('SELECT id, name, lobe_config FROM workspaces WHERE id = ?').get(Number(id)) as any;
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    return NextResponse.json({ workspaceId: ws.id, name: ws.name, config: parseLobeConfig(ws.lobe_config) });
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const db = getDb();
    const body = await request.json() as Partial<LobeConfig>;

    const ws = db.prepare('SELECT lobe_config FROM workspaces WHERE id = ?').get(Number(id)) as any;
    if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });

    const current = parseLobeConfig(ws.lobe_config);
    const updated: LobeConfig = {
      isPrivate: body.isPrivate ?? current.isPrivate,
      excludedFrom: body.excludedFrom ?? current.excludedFrom,
      subscriptions: body.subscriptions ?? current.subscriptions,
      tags: body.tags ?? current.tags,
    };

    db.prepare('UPDATE workspaces SET lobe_config = ? WHERE id = ?').run(serializeLobeConfig(updated), Number(id));
    return NextResponse.json({ config: updated });
  });
}
```

- [ ] **Step 3: Create share endpoint**

```typescript
// src/app/api/cortex/lobes/share/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';
import { LobeShareStore } from '@/lib/cortex/lobes/shares';
import { slugify } from '@/lib/cortex/graph/types';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) return NextResponse.json({ incoming: [], outgoing: [] });
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ incoming: [], outgoing: [] });

    const shareStore = new LobeShareStore(cortex.graph['db']);
    const userId = `person-${slugify(user)}`;

    return NextResponse.json({
      incoming: shareStore.listIncoming(userId),
      outgoing: shareStore.listOutgoing(userId),
    });
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex unavailable' }, { status: 500 });

    const body = await request.json();
    const { action, shareId, workspaceId, lobeName, sharedWithUserId } = body;
    const shareStore = new LobeShareStore(cortex.graph['db']);
    const userId = `person-${slugify(user)}`;

    if (action === 'share') {
      const share = shareStore.share({
        ownerUserId: userId,
        ownerWorkspaceId: workspaceId,
        ownerLobeName: lobeName,
        sharedWithUserId,
      });
      return NextResponse.json({ share }, { status: 201 });
    }

    if (action === 'accept') {
      shareStore.accept(shareId);
      return NextResponse.json({ accepted: true });
    }

    if (action === 'revoke' || action === 'decline') {
      shareStore.revoke(shareId);
      return NextResponse.json({ revoked: true });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cortex/lobes/
git commit -m "feat(cortex): add lobe API endpoints for config and sharing"
```

---

### Task 7: Lobe settings UI component

**Files:**
- Create: `src/components/cortex/lobe-settings.tsx`

- [ ] **Step 1: Create the component**

A settings panel showing the workspace's knowledge sources with toggles, tags, and subscription management.

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Shield, ShieldOff, Tag, Plus, X, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { LobeConfig, LobeSubscription } from '@/lib/cortex/lobes/config';

interface LobeSettingsProps {
  workspaceId: number;
  workspaceName: string;
}

export function LobeSettings({ workspaceId, workspaceName }: LobeSettingsProps) {
  const [config, setConfig] = useState<LobeConfig | null>(null);
  const [allLobes, setAllLobes] = useState<any[]>([]);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    const res = await fetch(api(`/api/cortex/lobes/${workspaceId}`));
    if (res.ok) {
      const data = await res.json();
      setConfig(data.config);
    }
  }, [workspaceId]);

  const fetchAllLobes = useCallback(async () => {
    const res = await fetch(api('/api/cortex/lobes'));
    if (res.ok) {
      const data = await res.json();
      setAllLobes(data.lobes || []);
    }
  }, []);

  useEffect(() => { fetchConfig(); fetchAllLobes(); }, [fetchConfig, fetchAllLobes]);

  const save = async (updates: Partial<LobeConfig>) => {
    setSaving(true);
    await fetch(api(`/api/cortex/lobes/${workspaceId}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    await fetchConfig();
    setSaving(false);
  };

  if (!config) return <div className="text-gray-500 text-sm p-4">Loading...</div>;

  const activeSourceCount = allLobes.filter(l =>
    l.workspaceId !== workspaceId && !l.config.isPrivate && !l.config.excludedFrom?.includes(workspaceId)
  ).length + 2; // +2 for personal + team

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-gray-200 mb-1">Knowledge Lobes</h3>
        <p className="text-xs text-gray-500">
          This workspace draws from {activeSourceCount} lobes.
          {config.isPrivate && ' This lobe is private — other workspaces cannot access its knowledge.'}
        </p>
      </div>

      {/* Privacy toggle */}
      <div className="flex items-center justify-between py-3 border-t border-white/5">
        <div className="flex items-center gap-2">
          {config.isPrivate ? <ShieldOff className="w-4 h-4 text-red-400" /> : <Shield className="w-4 h-4 text-green-400" />}
          <div>
            <div className="text-sm text-gray-200">Private lobe</div>
            <div className="text-[10px] text-gray-500">Other workspaces cannot access this knowledge</div>
          </div>
        </div>
        <button
          onClick={() => save({ isPrivate: !config.isPrivate })}
          disabled={saving}
          className={`px-3 py-1 text-xs rounded ${config.isPrivate ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-400'}`}
        >
          {config.isPrivate ? 'Private' : 'Open'}
        </button>
      </div>

      {/* Tags */}
      <div className="border-t border-white/5 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <Tag className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-400">Tags</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {config.tags.map(tag => (
            <span key={tag} className="flex items-center gap-1 text-[11px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded">
              {tag}
              <button onClick={() => save({ tags: config.tags.filter(t => t !== tag) })} className="hover:text-white">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && newTag.trim()) {
                save({ tags: [...config.tags, newTag.trim()] });
                setNewTag('');
              }
            }}
            placeholder="Add tag..."
            className="flex-1 px-2 py-1 text-xs bg-white/5 border border-white/10 rounded text-gray-300 focus:outline-none focus:border-purple-500/50"
          />
        </div>
      </div>

      {/* Subscriptions */}
      <div className="border-t border-white/5 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <Plus className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-400">Additional sources</span>
        </div>
        {config.subscriptions.length === 0 ? (
          <p className="text-[11px] text-gray-600">No additional subscriptions. Using defaults.</p>
        ) : (
          <div className="space-y-1">
            {config.subscriptions.map((sub, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-white/[0.02] rounded px-2 py-1.5">
                <span className="text-gray-300">{sub.label} <span className="text-gray-600">({sub.type})</span></span>
                <button
                  onClick={() => save({ subscriptions: config.subscriptions.filter((_, j) => j !== i) })}
                  className="text-gray-600 hover:text-red-400"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Exclusions */}
      <div className="border-t border-white/5 pt-3">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-400">Excluded workspaces</span>
        </div>
        {config.excludedFrom.length === 0 ? (
          <p className="text-[11px] text-gray-600">No exclusions. All workspaces can access this lobe.</p>
        ) : (
          <div className="space-y-1">
            {config.excludedFrom.map(wsId => {
              const ws = allLobes.find(l => l.workspaceId === wsId);
              return (
                <div key={wsId} className="flex items-center justify-between text-xs bg-white/[0.02] rounded px-2 py-1.5">
                  <span className="text-gray-300">{ws?.name || `Workspace ${wsId}`}</span>
                  <button
                    onClick={() => save({ excludedFrom: config.excludedFrom.filter(id => id !== wsId) })}
                    className="text-gray-600 hover:text-red-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/cortex/lobe-settings.tsx
git commit -m "feat(cortex): add lobe settings UI component"
```

---

### Task 8: Barrel export and wiring

**Files:**
- Create: `src/lib/cortex/lobes/index.ts`
- Modify: `src/app/(desktop)/cortex/page.tsx` — add Lobes section to Settings tab

- [ ] **Step 1: Create barrel export**

```typescript
// src/lib/cortex/lobes/index.ts
export { parseLobeConfig, serializeLobeConfig, DEFAULT_LOBE_CONFIG } from './config';
export type { LobeConfig, LobeSubscription } from './config';
export { resolveLobes } from './resolver';
export type { ResolvedLobe } from './resolver';
export { LobeShareStore } from './shares';
export type { LobeShare } from './shares';
```

- [ ] **Step 2: Add LobeSettings to the Cortex page Settings tab**

Read `src/app/(desktop)/cortex/page.tsx`. Find the Settings tab rendering. Currently it shows `<CortexSettings />`. Add `<LobeSettings>` below it, but only when a workspace is active. The workspace ID needs to come from somewhere — check how the terminal page gets `activeWorkspace`:

Read `src/app/(desktop)/terminal/page.tsx` to see how `activeWorkspace` is loaded. The pattern is likely a fetch to `/api/workspaces` with `is_active=1`.

For the Cortex page, add a simple workspace selector or use the active workspace. The simplest approach: fetch the active workspace and pass its ID to LobeSettings.

```typescript
// In CortexPage, add state:
const [activeWorkspace, setActiveWorkspace] = useState<any>(null);

// Fetch active workspace:
useEffect(() => {
  fetch(api('/api/workspaces'))
    .then(r => r.json())
    .then(data => {
      const active = (data.workspaces || []).find((w: any) => w.isActive);
      setActiveWorkspace(active);
    })
    .catch(() => {});
}, []);

// In Settings tab rendering, add LobeSettings:
{tab === 'settings' && (
  <div className="p-6 max-w-2xl space-y-8">
    <CortexSettings />
    {activeWorkspace && (
      <LobeSettings
        workspaceId={activeWorkspace.id}
        workspaceName={activeWorkspace.name}
      />
    )}
  </div>
)}
```

Import: `import { LobeSettings } from '@/components/cortex/lobe-settings';`

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run tests/lib/cortex/`

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/lobes/index.ts src/app/(desktop)/cortex/page.tsx
git commit -m "feat(cortex): wire lobe settings into Cortex page"
```

---

## Summary

| Task | Component | Tests | Status |
|------|-----------|-------|--------|
| 1 | Lobe config types | — | |
| 2 | DB migration (lobe_config column) | — | |
| 3 | Lobe resolver | 8 | |
| 4 | Cross-user sharing | 6 | |
| 5 | Context Engine integration | regression | |
| 6 | API endpoints (3 files) | — | |
| 7 | Lobe settings UI component | — | |
| 8 | Barrel export + page wiring | regression | |

**Total: 8 tasks, ~14 new tests, 3 chunks**

**Key design decisions:**
- Lobe config stored as JSON column on workspaces table (simple, always loaded with workspace)
- Resolver computes accessible lobes at query time from workspace list + config
- Cross-user shares use a separate SQLite table in the entity graph DB with two-step handshake
- Context Engine uses resolved lobes when provided, falls back to hardcoded layers for backward compat
- Privacy is safe-by-default: private workspaces are excluded, cross-user is closed by default
- Base weights: own=1.0, personal=0.9, sibling workspaces=0.6, team=0.5, subscribed=0.4
