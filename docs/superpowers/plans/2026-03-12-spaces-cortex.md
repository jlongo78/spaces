# Spaces Cortex Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Cortex distributed intelligence system — a continuous RAG-based knowledge layer that ingests all AI agent conversations into LanceDB vector databases and automatically injects relevant context into every prompt.

**Architecture:** Cortex is a premium feature (Teams/Federation tiers only). It adds a `src/lib/cortex/` module with LanceDB storage, a 3-tier ingestion pipeline (fast pass → embedding → distillation), multi-layer retrieval with scoring, an MCP server for agent integration, REST API, and UI components. Federation tier adds cross-node query delegation and Cortex-to-Cortex active knowledge propagation.

**Tech Stack:** LanceDB (`@lancedb/lancedb`), Transformers.js (`@huggingface/transformers`) for local embeddings, Voyage AI / OpenAI for cloud embeddings, vitest for testing, existing Next.js App Router patterns.

**Spec:** `docs/superpowers/specs/2026-03-12-spaces-brain-design.md`

---

## File Structure

### New Files

```
src/lib/cortex/
├── index.ts                 — Cortex singleton: init(), isEnabled(), getInstance()
├── config.ts                — CortexConfig type, readCortexConfig(), writeCortexConfig()
├── store.ts                 — LanceDB connection, table management, health checks
├── embeddings/
│   ├── index.ts             — EmbeddingProvider interface, auto-detect chain
│   ├── voyage.ts            — Voyage AI provider (VOYAGE_API_KEY)
│   ├── openai.ts            — OpenAI provider (OPENAI_API_KEY)
│   └── local.ts             — @huggingface/transformers ONNX local provider
├── ingestion/
│   ├── pipeline.ts          — Ingestion pipeline orchestrator (Tier 1→2→3)
│   ├── chunker.ts           — Message chunking at turn/topic/tool boundaries
│   ├── extractors.ts        — Code blocks, file refs, errors, commands, git, tool calls
│   ├── deduplicator.ts      — Cosine similarity dedup (>0.95 = skip)
│   ├── bootstrap.ts         — Historical session bulk ingestion with progress
│   └── watcher.ts           — Live file watcher (extends existing chokidar watcher)
├── distillation/
│   ├── distiller.ts         — Background LLM knowledge extraction
│   ├── prompts.ts           — Distillation prompt templates
│   └── scheduler.ts         — Idle-time scheduling
├── retrieval/
│   ├── search.ts            — Multi-layer vector search with reranking
│   ├── injection.ts         — cortex-context block formatting
│   ├── federation.ts        — Remote node query delegation
│   └── scoring.ts           — Confidence, staleness, relevance scoring
├── knowledge/
│   ├── types.ts             — KnowledgeUnit, KnowledgeType, Layer, all interfaces
│   ├── staleness.ts         — Staleness detection and time decay
│   └── contradiction.ts     — Contradiction detection between units
├── portability/
│   ├── exporter.ts          — .cortexpack tar.gz export
│   └── importer.ts          — .cortexpack import with merge strategies
└── mcp/
    └── server.ts            — MCP server: cortex_search, cortex_teach, etc.

src/app/api/cortex/
├── status/route.ts          — GET: health + stats
├── search/route.ts          — GET: semantic search
├── knowledge/route.ts       — POST: create (teach)
├── knowledge/[id]/route.ts  — GET, PATCH, DELETE: single unit CRUD
├── workspace/[id]/context/route.ts — GET: full workspace context
├── timeline/route.ts        — GET: chronological history
├── ingest/bootstrap/route.ts — POST: trigger bootstrap
├── ingest/status/route.ts   — GET: bootstrap progress
├── export/route.ts          — POST: export .cortexpack
├── import/route.ts          — POST: import .cortexpack
├── import/status/route.ts   — GET: import progress
├── settings/route.ts        — GET, POST: cortex settings
└── federation/
    ├── search/route.ts      — GET: remote search endpoint
    ├── stream/route.ts      — WS: real-time sync
    ├── teach/route.ts       — POST: receive propagated knowledge
    ├── pending/route.ts     — GET: pending contradictions
    └── resolve/route.ts     — POST: resolve contradiction

src/components/cortex/
├── cortex-indicator.tsx     — Top bar status badge (purple dot + count)
├── cortex-panel.tsx         — Slide-out knowledge explorer
├── cortex-settings.tsx      — Settings page section
├── knowledge-card.tsx       — Individual knowledge unit card
└── injection-badge.tsx      — Pane header injection indicator

tests/lib/cortex/
├── config.test.ts
├── store.test.ts
├── embeddings/
│   ├── index.test.ts
│   └── local.test.ts
├── ingestion/
│   ├── chunker.test.ts
│   ├── extractors.test.ts
│   ├── deduplicator.test.ts
│   └── pipeline.test.ts
├── retrieval/
│   ├── scoring.test.ts
│   └── search.test.ts
├── knowledge/
│   ├── staleness.test.ts
│   └── contradiction.test.ts
└── portability/
    ├── exporter.test.ts
    └── importer.test.ts
```

### Files to Modify

- `src/lib/config.ts` — Add `cortex?: CortexConfig` to `SpacesConfig`, update `readConfig`/`writeConfig` to preserve it
- `src/lib/tier.ts` — Add `HAS_CORTEX` constant (alias for `IS_TEAM`)
- `src/hooks/use-tier.ts` — Add `hasCortex` flag to `TierFlags`
- `src/components/layout/sidebar.tsx` — Add Cortex indicator to sidebar (the main navigation bar)
- `src/app/(desktop)/settings/page.tsx` — Add Cortex settings section
- `src/components/terminal/terminal-pane.tsx` — Add injection badge to pane header
- `package.json` — Add `@lancedb/lancedb`, `@huggingface/transformers`, `vitest` dependencies
- `tsconfig.json` — Add test paths if needed

---

## Chunk 1: Foundation

### Task 1: Install Dependencies and Test Framework

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`

- [ ] **Step 1: Install production dependencies**

```bash
npm install @lancedb/lancedb @huggingface/transformers
```

- [ ] **Step 2: Install dev dependencies**

```bash
npm install -D vitest @vitest/coverage-v8
```

- [ ] **Step 3: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: '.',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/cortex/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 4: Create test setup file**

Create `tests/setup.ts`:

```typescript
import { vi } from 'vitest';

// Mock the auth module for tests - Cortex tests don't need real auth
vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => 'test-user',
  getAuthUser: () => 'test-user',
  withUser: (_user: string, fn: () => any) => fn(),
}));
```

- [ ] **Step 5: Add test script to package.json**

Add to `scripts` in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 6: Verify vitest runs**

```bash
npx vitest run
```

Expected: 0 tests found, no errors.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts tests/setup.ts package.json package-lock.json
git commit -m "chore: add vitest and LanceDB/transformers dependencies"
```

---

### Task 2: Knowledge Types and Interfaces

**Files:**
- Create: `src/lib/cortex/knowledge/types.ts`
- Create: `tests/lib/cortex/knowledge/types.test.ts`

This is the foundational type system. Every other module depends on these types.

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/knowledge/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  KNOWLEDGE_TYPES,
  LAYERS,
  type KnowledgeUnit,
  type KnowledgeType,
  type Layer,
  type ProvenanceChain,
  isValidKnowledgeType,
  isValidLayer,
  getConfidenceBase,
  getHalflifeDays,
} from '@/lib/cortex/knowledge/types';

describe('knowledge types', () => {
  it('defines all 9 knowledge types', () => {
    expect(KNOWLEDGE_TYPES).toHaveLength(9);
    expect(KNOWLEDGE_TYPES).toContain('decision');
    expect(KNOWLEDGE_TYPES).toContain('preference');
    expect(KNOWLEDGE_TYPES).toContain('error_fix');
    expect(KNOWLEDGE_TYPES).toContain('conversation');
  });

  it('defines 3 layers', () => {
    expect(LAYERS).toEqual(['personal', 'workspace', 'team']);
  });

  it('validates knowledge types', () => {
    expect(isValidKnowledgeType('decision')).toBe(true);
    expect(isValidKnowledgeType('invalid')).toBe(false);
  });

  it('validates layers', () => {
    expect(isValidLayer('personal')).toBe(true);
    expect(isValidLayer('federation')).toBe(false);
  });

  it('returns correct confidence base per type', () => {
    expect(getConfidenceBase('decision')).toBe(0.8);
    expect(getConfidenceBase('preference')).toBe(0.95);
    expect(getConfidenceBase('conversation')).toBe(0.4);
  });

  it('returns correct halflife per type', () => {
    expect(getHalflifeDays('decision')).toBe(180);
    expect(getHalflifeDays('pattern')).toBe(90);
    expect(getHalflifeDays('conversation')).toBe(14);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/cortex/knowledge/types.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement types**

Create `src/lib/cortex/knowledge/types.ts`:

```typescript
// ─── Knowledge Types ─────────────────────────────────────────

export const KNOWLEDGE_TYPES = [
  'decision', 'pattern', 'preference', 'error_fix',
  'context', 'code_pattern', 'command', 'conversation', 'summary',
] as const;
export type KnowledgeType = typeof KNOWLEDGE_TYPES[number];

export const LAYERS = ['personal', 'workspace', 'team'] as const;
export type Layer = typeof LAYERS[number];

export type AgentType = 'claude' | 'codex' | 'gemini' | 'aider';

export function isValidKnowledgeType(s: string): s is KnowledgeType {
  return (KNOWLEDGE_TYPES as readonly string[]).includes(s);
}

export function isValidLayer(s: string): s is Layer {
  return (LAYERS as readonly string[]).includes(s);
}

// ─── Confidence & Staleness Defaults ─────────────────────────

const CONFIDENCE_BASE: Record<KnowledgeType, number> = {
  decision: 0.8, pattern: 0.8, preference: 0.95, error_fix: 0.8,
  context: 0.6, code_pattern: 0.7, command: 0.6, conversation: 0.4, summary: 0.6,
};

const HALFLIFE_DAYS: Record<KnowledgeType, number> = {
  decision: 180, pattern: 90, preference: 180, error_fix: 90,
  context: 30, code_pattern: 60, command: 30, conversation: 14, summary: 60,
};

export function getConfidenceBase(type: KnowledgeType): number {
  return CONFIDENCE_BASE[type];
}

export function getHalflifeDays(type: KnowledgeType): number {
  return HALFLIFE_DAYS[type];
}

// ─── Core Interfaces ─────────────────────────────────────────

export interface KnowledgeUnit {
  id: string;
  vector: number[];
  text: string;
  type: KnowledgeType;
  layer: Layer;
  workspace_id: number | null;
  session_id: string | null;
  agent_type: AgentType;
  project_path: string | null;
  file_refs: string[];
  confidence: number;
  created: string;           // ISO timestamp
  source_timestamp: string;  // ISO timestamp
  stale_score: number;       // 0.0–1.0
  access_count: number;
  last_accessed: string | null;
  metadata: Record<string, unknown>;
}

/** A chunk produced by Tier 1 fast pass, before embedding. */
export interface RawChunk {
  text: string;
  type: KnowledgeType;
  layer: Layer;
  workspace_id: number | null;
  session_id: string | null;
  agent_type: AgentType;
  project_path: string | null;
  file_refs: string[];
  source_timestamp: string;
  metadata: Record<string, unknown>;
}

/** Provenance chain for federation-propagated knowledge. */
export interface ProvenanceChain {
  origin_node: string;
  origin_timestamp: string;
  hops: Array<{
    node: string;
    confidence: number;
    timestamp: string;
  }>;
  max_hops: number;
}

/** Search result with computed relevance score. */
export interface ScoredKnowledge extends KnowledgeUnit {
  relevance_score: number;  // similarity × confidence × (1 - stale_score) × recency_boost
  similarity: number;        // raw cosine similarity
}

/** Types that are high-value and should never be auto-pruned. */
export const PROTECTED_TYPES: KnowledgeType[] = ['decision', 'preference', 'error_fix'];

/** Types eligible for federation propagation. */
export const PROPAGATABLE_TYPES: KnowledgeType[] = ['decision', 'pattern', 'preference', 'error_fix'];

/** Minimum confidence for propagation. */
export const PROPAGATION_CONFIDENCE_THRESHOLD = 0.85;

/** Confidence multiplier per federation hop. */
export const HOP_DECAY_FACTOR = 0.8;

/** Max federation hops. */
export const MAX_HOPS = 3;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/cortex/knowledge/types.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/knowledge/types.ts tests/lib/cortex/knowledge/types.test.ts
git commit -m "feat(cortex): add knowledge types and interfaces"
```

---

### Task 3: Cortex Configuration

**Files:**
- Create: `src/lib/cortex/config.ts`
- Modify: `src/lib/config.ts` — extend SpacesConfig
- Modify: `src/lib/tier.ts` — add HAS_CORTEX
- Create: `tests/lib/cortex/config.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock tier to simulate Teams tier
vi.mock('@/lib/tier', () => ({
  IS_TEAM: true,
  IS_FEDERATION: false,
  HAS_CORTEX: true,
  TIER: 'team',
  HAS_AUTH: true,
  HAS_MULTIUSER: true,
  HAS_ADMIN: true,
  HAS_COLLABORATION: true,
  HAS_NETWORK: false,
  IS_DESKTOP: false,
}));

import {
  DEFAULT_CORTEX_CONFIG,
  readCortexConfig,
  writeCortexConfig,
  type CortexConfig,
} from '@/lib/cortex/config';

describe('cortex config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has sensible defaults', () => {
    expect(DEFAULT_CORTEX_CONFIG.enabled).toBe(true);
    expect(DEFAULT_CORTEX_CONFIG.embedding.provider).toBe('auto');
    expect(DEFAULT_CORTEX_CONFIG.injection.max_tokens).toBe(2000);
    expect(DEFAULT_CORTEX_CONFIG.injection.max_results).toBe(5);
    expect(DEFAULT_CORTEX_CONFIG.federation.sync_mode).toBe('query-only');
  });

  it('reads config from file', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      cortex: { enabled: false, injection: { max_tokens: 500 } },
    }));

    const config = readCortexConfig(configPath);
    expect(config.enabled).toBe(false);
    expect(config.injection.max_tokens).toBe(500);
    // Unspecified fields get defaults
    expect(config.injection.max_results).toBe(5);
    expect(config.embedding.provider).toBe('auto');
  });

  it('returns defaults when no cortex key exists', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ installId: 'abc' }));

    const config = readCortexConfig(configPath);
    expect(config).toEqual(DEFAULT_CORTEX_CONFIG);
  });

  it('writes cortex config preserving other keys', () => {
    const configPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      installId: 'abc',
      devDirectories: ['/home/user/dev'],
    }));

    writeCortexConfig(configPath, { enabled: false });

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(raw.installId).toBe('abc');
    expect(raw.devDirectories).toEqual(['/home/user/dev']);
    expect(raw.cortex.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/cortex/config.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement cortex config**

Create `src/lib/cortex/config.ts`:

```typescript
import fs from 'fs';

export interface CortexConfig {
  enabled: boolean;
  embedding: {
    provider: 'auto' | 'voyage' | 'openai' | 'local';
    model: string | null;
    fallback: 'local';
    dimensions: number | null;  // null = auto-detect from provider
  };
  injection: {
    enabled: boolean;
    max_tokens: number;
    max_results: number;
    min_confidence: number;
  };
  ingestion: {
    auto_ingest: boolean;
    distillation: boolean;
    distillation_model: 'auto' | string;
  };
  layers: {
    personal: boolean;
    workspace: boolean;
    team: boolean;
  };
  staleness: {
    decision_halflife_days: number;
    pattern_halflife_days: number;
    context_halflife_days: number;
    conversation_halflife_days: number;
  };
  federation: {
    sync_mode: 'query-only' | 'background-sync' | 'real-time-sync';
    sync_interval_minutes: number;
    query_timeout_ms: number;
  };
  storage: {
    max_size_mb: number;
    warning_threshold_mb: number;
  };
}

export const DEFAULT_CORTEX_CONFIG: CortexConfig = {
  enabled: true,
  embedding: { provider: 'auto', model: null, fallback: 'local', dimensions: null },
  injection: { enabled: true, max_tokens: 2000, max_results: 5, min_confidence: 0.3 },
  ingestion: { auto_ingest: true, distillation: true, distillation_model: 'auto' },
  layers: { personal: true, workspace: true, team: true },
  staleness: {
    decision_halflife_days: 180,
    pattern_halflife_days: 90,
    context_halflife_days: 30,
    conversation_halflife_days: 14,
  },
  federation: { sync_mode: 'query-only', sync_interval_minutes: 5, query_timeout_ms: 500 },
  storage: { max_size_mb: 2048, warning_threshold_mb: 500 },
};

/** Deep-merge defaults with partial config. */
function mergeDefaults(partial: Record<string, any>): CortexConfig {
  const result = JSON.parse(JSON.stringify(DEFAULT_CORTEX_CONFIG));
  for (const [key, value] of Object.entries(partial)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && key in result) {
      result[key] = { ...result[key], ...value };
    } else if (key in result) {
      result[key] = value;
    }
  }
  return result;
}

/** Read cortex config from a spaces config.json file. */
export function readCortexConfig(configPath: string): CortexConfig {
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (raw.cortex && typeof raw.cortex === 'object') {
        return mergeDefaults(raw.cortex);
      }
    }
  } catch { /* corrupt file, return defaults */ }
  return { ...DEFAULT_CORTEX_CONFIG };
}

/** Write cortex config, preserving all other keys in the file. */
export function writeCortexConfig(configPath: string, updates: Partial<CortexConfig>): void {
  let existing: Record<string, any> = {};
  try {
    if (fs.existsSync(configPath)) {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* corrupt, overwrite */ }

  const currentCortex = existing.cortex && typeof existing.cortex === 'object'
    ? mergeDefaults(existing.cortex)
    : { ...DEFAULT_CORTEX_CONFIG };

  // Shallow merge updates into current cortex config
  for (const [key, value] of Object.entries(updates)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && key in currentCortex) {
      (currentCortex as any)[key] = { ...(currentCortex as any)[key], ...value };
    } else if (key in currentCortex) {
      (currentCortex as any)[key] = value;
    }
  }

  existing.cortex = currentCortex;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}
```

- [ ] **Step 4: Add HAS_CORTEX to tier.ts**

In `src/lib/tier.ts`, add after `HAS_NETWORK`:

```typescript
export const HAS_CORTEX = IS_TEAM;
```

- [ ] **Step 5: Add hasCortex to use-tier.ts**

In `src/hooks/use-tier.ts`:
1. Add `hasCortex: boolean` to the `TierFlags` interface
2. Add `hasCortex: false` to the default flags object
3. In the `getTierFlags()` function (or wherever `TierFlags` is populated from the server), set `hasCortex` based on the server's `HAS_CORTEX` value. The `/api/tier` endpoint should include this field in its response.

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run tests/lib/cortex/config.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/cortex/config.ts src/lib/tier.ts src/hooks/use-tier.ts tests/lib/cortex/config.test.ts
git commit -m "feat(cortex): add cortex config with tier gating"
```

---

### Task 4: LanceDB Store

**Files:**
- Create: `src/lib/cortex/store.ts`
- Create: `tests/lib/cortex/store.test.ts`

The store manages LanceDB connections and table lifecycle. Each knowledge layer gets its own LanceDB table in a separate directory.

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { CortexStore } from '@/lib/cortex/store';

describe('CortexStore', () => {
  let tmpDir: string;
  let store: CortexStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-store-'));
    store = new CortexStore(tmpDir);
    await store.init(384); // MiniLM dimensions
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes and creates data directory', async () => {
    expect(fs.existsSync(path.join(tmpDir, 'personal'))).toBe(true);
  });

  it('adds and searches knowledge units', async () => {
    const vector = new Array(384).fill(0).map(() => Math.random());
    await store.add('personal', {
      id: 'test-1',
      vector,
      text: 'Use JWT for auth',
      type: 'decision',
      layer: 'personal',
      workspace_id: null,
      session_id: 'sess-1',
      agent_type: 'claude',
      project_path: '/project',
      file_refs: ['src/auth.ts'],
      confidence: 0.85,
      created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(),
      stale_score: 0,
      access_count: 0,
      last_accessed: null,
      metadata: {},
    });

    const results = await store.search('personal', vector, 5);
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('Use JWT for auth');
  });

  it('deletes knowledge units by id', async () => {
    const vector = new Array(384).fill(0.5);
    await store.add('personal', {
      id: 'del-1', vector, text: 'to delete', type: 'context',
      layer: 'personal', workspace_id: null, session_id: null,
      agent_type: 'claude', project_path: null, file_refs: [],
      confidence: 0.5, created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(), stale_score: 0,
      access_count: 0, last_accessed: null, metadata: {},
    });

    await store.delete('personal', 'del-1');
    const results = await store.search('personal', vector, 5);
    expect(results).toHaveLength(0);
  });

  it('reports stats', async () => {
    const stats = await store.stats();
    expect(stats).toHaveProperty('personal');
    expect(typeof stats.personal.count).toBe('number');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/cortex/store.test.ts
```

- [ ] **Step 3: Implement store**

Create `src/lib/cortex/store.ts`:

```typescript
import * as lancedb from '@lancedb/lancedb';
import path from 'path';
import fs from 'fs';
import type { KnowledgeUnit, Layer } from './knowledge/types';

const TABLE_NAME = 'knowledge';

export class CortexStore {
  private baseDir: string;
  private connections = new Map<string, lancedb.Connection>();
  private dimensions: number = 384;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async init(dimensions: number): Promise<void> {
    this.dimensions = dimensions;
    // Ensure layer directories exist
    for (const layer of ['personal', 'workspace', 'team']) {
      const dir = path.join(this.baseDir, layer);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private async getConnection(layerPath: string): Promise<lancedb.Connection> {
    if (!this.connections.has(layerPath)) {
      const dir = path.join(this.baseDir, layerPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const conn = await lancedb.connect(dir);
      this.connections.set(layerPath, conn);
    }
    return this.connections.get(layerPath)!;
  }

  /** Resolve layer path: 'personal' or 'workspace/123' or 'team'. */
  private layerPath(layer: Layer, workspaceId?: number | null): string {
    if (layer === 'workspace' && workspaceId) {
      return path.join('workspace', String(workspaceId));
    }
    return layer;
  }

  async add(layerKey: string, unit: KnowledgeUnit): Promise<void> {
    const conn = await this.getConnection(layerKey);
    const tableNames = await conn.tableNames();
    const record = {
      id: unit.id,
      vector: unit.vector,
      text: unit.text,
      type: unit.type,
      layer: unit.layer,
      workspace_id: unit.workspace_id,
      session_id: unit.session_id,
      agent_type: unit.agent_type,
      project_path: unit.project_path,
      file_refs: JSON.stringify(unit.file_refs),
      confidence: unit.confidence,
      created: unit.created,
      source_timestamp: unit.source_timestamp,
      stale_score: unit.stale_score,
      access_count: unit.access_count,
      last_accessed: unit.last_accessed || '',
      metadata: JSON.stringify(unit.metadata),
    };

    if (tableNames.includes(TABLE_NAME)) {
      const table = await conn.openTable(TABLE_NAME);
      await table.add([record]);
    } else {
      await conn.createTable(TABLE_NAME, [record]);
    }
  }

  async search(
    layerKey: string,
    queryVector: number[],
    limit: number,
    filter?: string,
  ): Promise<KnowledgeUnit[]> {
    const conn = await this.getConnection(layerKey);
    const tableNames = await conn.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return [];

    const table = await conn.openTable(TABLE_NAME);
    let query = table.vectorSearch(queryVector).limit(limit);
    if (filter) {
      query = query.where(filter);
    }
    const rows = await query.toArray();

    return rows.map((row: any) => ({
      ...row,
      file_refs: JSON.parse(row.file_refs || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      last_accessed: row.last_accessed || null,
    }));
  }

  async delete(layerKey: string, id: string): Promise<void> {
    const conn = await this.getConnection(layerKey);
    const tableNames = await conn.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return;

    const table = await conn.openTable(TABLE_NAME);
    // Sanitize id to prevent filter injection (LanceDB uses string filters)
    const safeId = id.replace(/'/g, "''");
    await table.delete(`id = '${safeId}'`);
  }

  async stats(): Promise<Record<string, { count: number }>> {
    const result: Record<string, { count: number }> = {};
    for (const layer of ['personal', 'workspace', 'team']) {
      try {
        const conn = await this.getConnection(layer);
        const tableNames = await conn.tableNames();
        if (tableNames.includes(TABLE_NAME)) {
          const table = await conn.openTable(TABLE_NAME);
          const count = await table.countRows();
          result[layer] = { count };
        } else {
          result[layer] = { count: 0 };
        }
      } catch {
        result[layer] = { count: 0 };
      }
    }
    return result;
  }

  async close(): Promise<void> {
    // LanceDB connections are lightweight file handles;
    // clearing the map releases our references so GC can collect them.
    // If lancedb adds an explicit close() in future, call it here.
    this.connections.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/cortex/store.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/store.ts tests/lib/cortex/store.test.ts
git commit -m "feat(cortex): add LanceDB store with CRUD and vector search"
```

---

### Task 5: Embedding Provider Chain

**Files:**
- Create: `src/lib/cortex/embeddings/index.ts`
- Create: `src/lib/cortex/embeddings/local.ts`
- Create: `src/lib/cortex/embeddings/voyage.ts`
- Create: `src/lib/cortex/embeddings/openai.ts`
- Create: `tests/lib/cortex/embeddings/index.test.ts`
- Create: `tests/lib/cortex/embeddings/local.test.ts`

- [ ] **Step 1: Write the embedding interface test**

Create `tests/lib/cortex/embeddings/index.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { type EmbeddingProvider, detectProvider } from '@/lib/cortex/embeddings';

describe('embedding provider detection', () => {
  it('falls back to local when no API keys', async () => {
    // No env vars set
    const provider = await detectProvider('auto');
    expect(provider.name).toBe('local');
    expect(provider.dimensions).toBe(384);
  });

  it('respects explicit provider choice', async () => {
    const provider = await detectProvider('local');
    expect(provider.name).toBe('local');
  });
});
```

- [ ] **Step 2: Write the local embedding test**

Create `tests/lib/cortex/embeddings/local.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { LocalEmbeddingProvider } from '@/lib/cortex/embeddings/local';

describe('LocalEmbeddingProvider', () => {
  // NOTE: First run downloads ~23MB model. Subsequent runs use cache.
  // Skip in CI if model not available.
  it('produces 384-dimension vectors', async () => {
    const provider = new LocalEmbeddingProvider();
    await provider.init();
    const vectors = await provider.embed(['hello world']);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(384);
    // Vectors should be normalized (unit length)
    const magnitude = Math.sqrt(vectors[0].reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 1);
  }, 60000); // 60s timeout for model download

  it('embeds multiple texts in batch', async () => {
    const provider = new LocalEmbeddingProvider();
    await provider.init();
    const vectors = await provider.embed(['first text', 'second text', 'third text']);
    expect(vectors).toHaveLength(3);
    vectors.forEach(v => expect(v).toHaveLength(384));
  }, 60000);
});
```

- [ ] **Step 3: Implement EmbeddingProvider interface and detection**

Create `src/lib/cortex/embeddings/index.ts`:

```typescript
export interface EmbeddingProvider {
  name: string;
  dimensions: number;
  init(): Promise<void>;
  embed(texts: string[]): Promise<number[][]>;
}

export async function detectProvider(
  preference: 'auto' | 'voyage' | 'openai' | 'local',
): Promise<EmbeddingProvider> {
  if (preference !== 'auto') {
    return createProvider(preference);
  }

  // Auto-detect: best available
  if (process.env.VOYAGE_API_KEY) {
    return createProvider('voyage');
  }
  if (process.env.OPENAI_API_KEY) {
    return createProvider('openai');
  }
  return createProvider('local');
}

async function createProvider(name: string): Promise<EmbeddingProvider> {
  switch (name) {
    case 'voyage': {
      const { VoyageEmbeddingProvider } = await import('./voyage');
      const p = new VoyageEmbeddingProvider();
      await p.init();
      return p;
    }
    case 'openai': {
      const { OpenAIEmbeddingProvider } = await import('./openai');
      const p = new OpenAIEmbeddingProvider();
      await p.init();
      return p;
    }
    default: {
      const { LocalEmbeddingProvider } = await import('./local');
      const p = new LocalEmbeddingProvider();
      await p.init();
      return p;
    }
  }
}
```

- [ ] **Step 4: Implement local embedding provider**

Create `src/lib/cortex/embeddings/local.ts`:

```typescript
import type { EmbeddingProvider } from './index';

export class LocalEmbeddingProvider implements EmbeddingProvider {
  name = 'local' as const;
  dimensions = 384;
  private pipeline: any = null;

  async init(): Promise<void> {
    if (this.pipeline) return;
    // Dynamic import to avoid bundling in production if not used
    const { pipeline } = await import('@huggingface/transformers');
    this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      // Use ONNX backend for Node.js
      device: 'cpu',
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.pipeline) await this.init();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }
}
```

- [ ] **Step 5: Implement Voyage AI provider**

Create `src/lib/cortex/embeddings/voyage.ts`:

```typescript
import type { EmbeddingProvider } from './index';

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  name = 'voyage' as const;
  dimensions = 1024;
  private apiKey: string = '';

  async init(): Promise<void> {
    this.apiKey = process.env.VOYAGE_API_KEY || '';
    if (!this.apiKey) throw new Error('VOYAGE_API_KEY not set');
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: 'voyage-3',
      }),
    });

    if (!response.ok) {
      throw new Error(`Voyage API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  }
}
```

- [ ] **Step 6: Implement OpenAI provider**

Create `src/lib/cortex/embeddings/openai.ts`:

```typescript
import type { EmbeddingProvider } from './index';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = 'openai' as const;
  dimensions = 1536;
  private apiKey: string = '';

  async init(): Promise<void> {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: 'text-embedding-3-small',
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.data
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((item: { embedding: number[] }) => item.embedding);
  }
}
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run tests/lib/cortex/embeddings/
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/cortex/embeddings/ tests/lib/cortex/embeddings/
git commit -m "feat(cortex): add embedding provider chain (Voyage → OpenAI → local)"
```

---

## Chunk 2: Ingestion Pipeline

### Task 6: Message Chunker

**Files:**
- Create: `src/lib/cortex/ingestion/chunker.ts`
- Create: `tests/lib/cortex/ingestion/chunker.test.ts`

The chunker splits raw JSONL session messages into semantic chunks at turn boundaries, topic shifts, and tool call boundaries.

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/ingestion/chunker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { chunkMessages, type SessionMessage } from '@/lib/cortex/ingestion/chunker';

const makeMsg = (role: string, text: string, toolUse?: boolean): SessionMessage => ({
  role,
  content: text,
  timestamp: new Date().toISOString(),
  hasToolUse: !!toolUse,
});

describe('chunkMessages', () => {
  it('creates chunks at turn boundaries', () => {
    const messages = [
      makeMsg('human', 'Add auth to the API'),
      makeMsg('assistant', 'I will add JWT auth with refresh tokens.'),
      makeMsg('human', 'Now add tests'),
      makeMsg('assistant', 'Writing tests for auth routes.'),
    ];
    const chunks = chunkMessages(messages, {
      sessionId: 'sess-1',
      workspaceId: 1,
      agentType: 'claude',
      projectPath: '/project',
    });
    // Should produce at least 2 chunks (one per human-assistant pair)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].text).toContain('Add auth');
    expect(chunks[0].session_id).toBe('sess-1');
  });

  it('extracts code blocks as separate chunks', () => {
    const messages = [
      makeMsg('assistant', 'Here is the code:\n```typescript\nfunction auth() { return true; }\n```'),
    ];
    const chunks = chunkMessages(messages, {
      sessionId: 'sess-1',
      workspaceId: null,
      agentType: 'claude',
      projectPath: null,
    });
    const codeChunks = chunks.filter(c => c.type === 'code_pattern');
    expect(codeChunks.length).toBeGreaterThanOrEqual(1);
    expect(codeChunks[0].text).toContain('function auth');
  });

  it('limits chunk text length', () => {
    const longText = 'x'.repeat(10000);
    const messages = [makeMsg('assistant', longText)];
    const chunks = chunkMessages(messages, {
      sessionId: 's', workspaceId: null, agentType: 'claude', projectPath: null,
    });
    chunks.forEach(c => expect(c.text.length).toBeLessThanOrEqual(4000));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement chunker**

Create `src/lib/cortex/ingestion/chunker.ts`:

```typescript
import type { RawChunk, AgentType } from '../knowledge/types';

const MAX_CHUNK_LENGTH = 4000;
const CODE_BLOCK_REGEX = /```(\w+)?\n([\s\S]*?)```/g;

export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
  hasToolUse?: boolean;
}

export interface ChunkContext {
  sessionId: string;
  workspaceId: number | null;
  agentType: AgentType;
  projectPath: string | null;
}

export function chunkMessages(messages: SessionMessage[], ctx: ChunkContext): RawChunk[] {
  const chunks: RawChunk[] = [];

  // Group into human-assistant pairs (turns)
  const turns: SessionMessage[][] = [];
  let current: SessionMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'human' && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) turns.push(current);

  for (const turn of turns) {
    const turnText = turn.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
    const timestamp = turn[turn.length - 1].timestamp;

    // Extract code blocks as separate chunks
    const codeBlocks = extractCodeBlocks(turnText);
    for (const block of codeBlocks) {
      chunks.push({
        text: block.code,
        type: 'code_pattern',
        layer: 'workspace',
        workspace_id: ctx.workspaceId,
        session_id: ctx.sessionId,
        agent_type: ctx.agentType,
        project_path: ctx.projectPath,
        file_refs: extractFileRefs(turnText),
        source_timestamp: timestamp,
        metadata: { language: block.language },
      });
    }

    // Main conversation chunk (without code blocks for brevity)
    const textWithoutCode = turnText.replace(CODE_BLOCK_REGEX, '[code block]');
    const truncated = textWithoutCode.slice(0, MAX_CHUNK_LENGTH);
    if (truncated.trim()) {
      chunks.push({
        text: truncated,
        type: 'conversation',
        layer: 'workspace',
        workspace_id: ctx.workspaceId,
        session_id: ctx.sessionId,
        agent_type: ctx.agentType,
        project_path: ctx.projectPath,
        file_refs: extractFileRefs(turnText),
        source_timestamp: timestamp,
        metadata: {},
      });
    }
  }

  return chunks;
}

function extractCodeBlocks(text: string): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  let match;
  const regex = new RegExp(CODE_BLOCK_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    const code = match[2].trim();
    if (code.length > 20) { // Skip trivially small code blocks
      blocks.push({
        language: match[1] || 'unknown',
        code: code.slice(0, MAX_CHUNK_LENGTH),
      });
    }
  }
  return blocks;
}

/** Extract file paths from text using common patterns. */
function extractFileRefs(text: string): string[] {
  const FILE_REF_REGEX = /(?:^|\s)((?:\.{0,2}\/)?(?:src|lib|tests?|app|bin|config|docs|scripts)\/[\w./-]+\.\w+)/gm;
  const refs = new Set<string>();
  let match;
  while ((match = FILE_REF_REGEX.exec(text)) !== null) {
    refs.add(match[1].trim());
  }
  return Array.from(refs);
}

export { extractFileRefs };
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/ingestion/chunker.ts tests/lib/cortex/ingestion/chunker.test.ts
git commit -m "feat(cortex): add message chunker for Tier 1 ingestion"
```

---

### Task 7: Extractors

**Files:**
- Create: `src/lib/cortex/ingestion/extractors.ts`
- Create: `tests/lib/cortex/ingestion/extractors.test.ts`

Heuristic extractors that detect error/fix pairs, commands, and other structured patterns from raw conversation text.

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/ingestion/extractors.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  detectErrorFixPairs,
  extractCommands,
  extractDecisionPatterns,
} from '@/lib/cortex/ingestion/extractors';

describe('extractors', () => {
  describe('detectErrorFixPairs', () => {
    it('detects error followed by resolution', () => {
      const text = `
[assistant]: Running the build...
Error: Cannot find module 'foo'
[human]: try installing it
[assistant]: Fixed! Installed foo with npm install foo.
      `;
      const pairs = detectErrorFixPairs(text);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].error).toContain('Cannot find module');
      expect(pairs[0].fix).toContain('npm install foo');
    });
  });

  describe('extractCommands', () => {
    it('extracts shell commands from code blocks', () => {
      const text = '```bash\nnpm install foo\nnpm run build\n```';
      const commands = extractCommands(text);
      expect(commands).toContain('npm install foo');
      expect(commands).toContain('npm run build');
    });
  });

  describe('extractDecisionPatterns', () => {
    it('detects decision language', () => {
      const text = "We decided to use Zod for validation because it integrates well with TypeScript.";
      const decisions = extractDecisionPatterns(text);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toContain('Zod');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement extractors**

Create `src/lib/cortex/ingestion/extractors.ts`:

```typescript
const ERROR_PATTERNS = [
  /(?:Error|ERROR|error):\s*(.+)/,
  /(?:TypeError|ReferenceError|SyntaxError):\s*(.+)/,
  /(?:ENOENT|EACCES|ECONNRESET|ECONNREFUSED|EPERM|EBUSY)(?::\s*(.+))?/,
  /(?:failed|Failed|FAILED)(?:\s+(?:to|with))?\s+(.+)/,
];

const FIX_PATTERNS = [
  /(?:fixed|Fixed|resolved|Resolved|solved|Solved)[!.]?\s*(.*)/i,
  /(?:the fix|the solution|to fix this|fixed by|resolved by)\s*(.*)/i,
];

const DECISION_PATTERNS = [
  /(?:we (?:decided|chose|went with|settled on|agreed))\s+(?:to\s+)?(.+)/i,
  /(?:let's use|using|switching to|going with)\s+(\S+)\s+(?:for|because|since)\s+(.+)/i,
  /(?:the approach|our approach|the plan) (?:is|will be)\s+(.+)/i,
];

export interface ErrorFixPair {
  error: string;
  fix: string;
}

export function detectErrorFixPairs(text: string): ErrorFixPair[] {
  const pairs: ErrorFixPair[] = [];
  const lines = text.split('\n');

  let lastError: string | null = null;
  let lastErrorIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for error
    for (const pattern of ERROR_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        lastError = line.trim();
        lastErrorIdx = i;
        break;
      }
    }

    // Check for fix (within 20 lines of error)
    if (lastError && i - lastErrorIdx < 20) {
      for (const pattern of FIX_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          pairs.push({ error: lastError, fix: line.trim() });
          lastError = null;
          break;
        }
      }
    }
  }

  return pairs;
}

export function extractCommands(text: string): string[] {
  const commands: string[] = [];
  const bashBlockRegex = /```(?:bash|sh|shell|zsh|cmd)?\n([\s\S]*?)```/g;
  let match;
  while ((match = bashBlockRegex.exec(text)) !== null) {
    const block = match[1].trim();
    for (const line of block.split('\n')) {
      const trimmed = line.replace(/^\$\s*/, '').trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        commands.push(trimmed);
      }
    }
  }
  return commands;
}

export function extractDecisionPatterns(text: string): string[] {
  const decisions: string[] = [];
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);

  for (const sentence of sentences) {
    for (const pattern of DECISION_PATTERNS) {
      if (pattern.test(sentence)) {
        decisions.push(sentence);
        break;
      }
    }
  }

  return decisions;
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/ingestion/extractors.ts tests/lib/cortex/ingestion/extractors.test.ts
git commit -m "feat(cortex): add heuristic extractors for errors, commands, decisions"
```

---

### Task 8: Deduplicator

**Files:**
- Create: `src/lib/cortex/ingestion/deduplicator.ts`
- Create: `tests/lib/cortex/ingestion/deduplicator.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/ingestion/deduplicator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { cosineSimilarity, isDuplicate } from '@/lib/cortex/ingestion/deduplicator';

describe('deduplicator', () => {
  it('computes cosine similarity correctly', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);

    const c = [0, 1, 0];
    expect(cosineSimilarity(a, c)).toBeCloseTo(0.0);
  });

  it('detects duplicates above threshold', () => {
    const v1 = [0.9, 0.1, 0.0];
    const v2 = [0.89, 0.11, 0.01];
    expect(isDuplicate(v1, v2, 0.95)).toBe(true);

    const v3 = [0.0, 1.0, 0.0];
    expect(isDuplicate(v1, v3, 0.95)).toBe(false);
  });
});
```

- [ ] **Step 2: Implement deduplicator**

Create `src/lib/cortex/ingestion/deduplicator.ts`:

```typescript
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function isDuplicate(
  newVector: number[],
  existingVector: number[],
  threshold = 0.95,
): boolean {
  return cosineSimilarity(newVector, existingVector) > threshold;
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run tests/lib/cortex/ingestion/deduplicator.test.ts
git add src/lib/cortex/ingestion/deduplicator.ts tests/lib/cortex/ingestion/deduplicator.test.ts
git commit -m "feat(cortex): add cosine similarity deduplicator"
```

---

### Task 9: Ingestion Pipeline Orchestrator

**Files:**
- Create: `src/lib/cortex/ingestion/pipeline.ts`
- Create: `src/lib/cortex/ingestion/watcher.ts`
- Create: `tests/lib/cortex/ingestion/pipeline.test.ts`

The pipeline orchestrates Tier 1 (chunking) → Tier 2 (embedding + store) → Tier 3 (queue for distillation).

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/ingestion/pipeline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionPipeline } from '@/lib/cortex/ingestion/pipeline';
import type { EmbeddingProvider } from '@/lib/cortex/embeddings';
import type { CortexStore } from '@/lib/cortex/store';

describe('IngestionPipeline', () => {
  let mockProvider: EmbeddingProvider;
  let mockStore: any;
  let pipeline: IngestionPipeline;

  beforeEach(() => {
    mockProvider = {
      name: 'test',
      dimensions: 3,
      init: vi.fn(),
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };
    mockStore = {
      add: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
    };
    pipeline = new IngestionPipeline(mockProvider, mockStore);
  });

  it('processes messages through Tier 1 and Tier 2', async () => {
    const messages = [
      { role: 'human', content: 'Add auth', timestamp: new Date().toISOString() },
      { role: 'assistant', content: 'Adding JWT auth now.', timestamp: new Date().toISOString() },
    ];

    const result = await pipeline.ingest(messages, {
      sessionId: 's1',
      workspaceId: 1,
      agentType: 'claude',
      projectPath: '/p',
    });

    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.chunksEmbedded).toBeGreaterThan(0);
    expect(mockProvider.embed).toHaveBeenCalled();
    expect(mockStore.add).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement pipeline**

Create `src/lib/cortex/ingestion/pipeline.ts`:

```typescript
import crypto from 'crypto';
import type { EmbeddingProvider } from '../embeddings';
import type { CortexStore } from '../store';
import type { KnowledgeUnit, RawChunk } from '../knowledge/types';
import { getConfidenceBase } from '../knowledge/types';
import { chunkMessages, type SessionMessage, type ChunkContext } from './chunker';

export interface IngestionResult {
  chunksCreated: number;
  chunksEmbedded: number;
  chunksSkipped: number;
  errors: string[];
}

export class IngestionPipeline {
  constructor(
    private embedding: EmbeddingProvider,
    private store: CortexStore,
  ) {}

  async ingest(
    messages: SessionMessage[],
    ctx: ChunkContext,
  ): Promise<IngestionResult> {
    const result: IngestionResult = {
      chunksCreated: 0, chunksEmbedded: 0, chunksSkipped: 0, errors: [],
    };

    // Tier 1: Fast pass — chunk messages
    let chunks: RawChunk[];
    try {
      chunks = chunkMessages(messages, ctx);
    } catch (err) {
      result.errors.push(`Tier 1 error: ${err}`);
      return result;
    }
    result.chunksCreated = chunks.length;

    // Tier 2: Embed and store
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => c.text);

      try {
        const vectors = await this.embedding.embed(texts);

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const layerKey = chunk.layer === 'workspace' && chunk.workspace_id
            ? `workspace/${chunk.workspace_id}`
            : chunk.layer;

          const unit: KnowledgeUnit = {
            id: crypto.randomUUID(),
            vector: vectors[j],
            text: chunk.text,
            type: chunk.type,
            layer: chunk.layer,
            workspace_id: chunk.workspace_id,
            session_id: chunk.session_id,
            agent_type: chunk.agent_type,
            project_path: chunk.project_path,
            file_refs: chunk.file_refs,
            confidence: getConfidenceBase(chunk.type),
            created: new Date().toISOString(),
            source_timestamp: chunk.source_timestamp,
            stale_score: 0,
            access_count: 0,
            last_accessed: null,
            metadata: chunk.metadata,
          };

          await this.store.add(layerKey, unit);
          result.chunksEmbedded++;
        }
      } catch (err) {
        result.errors.push(`Tier 2 batch error: ${err}`);
        result.chunksSkipped += batch.length;
      }
    }

    return result;
  }
}

// Note: getConfidenceBase is imported from '../knowledge/types' — do NOT duplicate here
```

- [ ] **Step 3: Implement watcher**

Create `src/lib/cortex/ingestion/watcher.ts`:

```typescript
import fs from 'fs';
import path from 'path';

export interface SyncState {
  filePath: string;
  mtime: number;
  byteOffset: number;
}

/**
 * Tracks which session files have been ingested and where we left off.
 * Uses a simple JSON file for state persistence.
 */
export class IngestionWatcher {
  private statePath: string;
  private state: Map<string, SyncState> = new Map();

  constructor(cortexDir: string) {
    this.statePath = path.join(cortexDir, 'ingest-state.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
        for (const entry of raw) {
          this.state.set(entry.filePath, entry);
        }
      }
    } catch { /* start fresh */ }
  }

  save(): void {
    fs.writeFileSync(this.statePath, JSON.stringify(Array.from(this.state.values()), null, 2));
  }

  needsSync(filePath: string): boolean {
    const stat = fs.statSync(filePath);
    const existing = this.state.get(filePath);
    if (!existing) return true;
    return stat.mtimeMs > existing.mtime || stat.size > existing.byteOffset;
  }

  markSynced(filePath: string, byteOffset: number): void {
    const stat = fs.statSync(filePath);
    this.state.set(filePath, {
      filePath,
      mtime: stat.mtimeMs,
      byteOffset,
    });
  }

  getOffset(filePath: string): number {
    return this.state.get(filePath)?.byteOffset ?? 0;
  }
}
```

- [ ] **Step 4: Write watcher test**

Create `tests/lib/cortex/ingestion/watcher.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { IngestionWatcher } from '@/lib/cortex/ingestion/watcher';

describe('IngestionWatcher', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-watcher-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports new files as needing sync', () => {
    const watcher = new IngestionWatcher(tmpDir);
    const testFile = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(testFile, '{"type":"human"}\n');
    expect(watcher.needsSync(testFile)).toBe(true);
  });

  it('reports synced files as not needing sync', () => {
    const watcher = new IngestionWatcher(tmpDir);
    const testFile = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(testFile, '{"type":"human"}\n');
    const size = fs.statSync(testFile).size;
    watcher.markSynced(testFile, size);
    expect(watcher.needsSync(testFile)).toBe(false);
  });

  it('persists and restores state', () => {
    const testFile = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(testFile, '{"type":"human"}\n');
    const size = fs.statSync(testFile).size;

    const watcher1 = new IngestionWatcher(tmpDir);
    watcher1.markSynced(testFile, size);
    watcher1.save();

    const watcher2 = new IngestionWatcher(tmpDir);
    expect(watcher2.needsSync(testFile)).toBe(false);
    expect(watcher2.getOffset(testFile)).toBe(size);
  });

  it('detects file changes after sync', () => {
    const watcher = new IngestionWatcher(tmpDir);
    const testFile = path.join(tmpDir, 'test.jsonl');
    fs.writeFileSync(testFile, '{"type":"human"}\n');
    watcher.markSynced(testFile, fs.statSync(testFile).size);

    // Append more data
    fs.appendFileSync(testFile, '{"type":"assistant"}\n');
    expect(watcher.needsSync(testFile)).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests, commit**

```bash
npx vitest run tests/lib/cortex/ingestion/
git add src/lib/cortex/ingestion/ tests/lib/cortex/ingestion/
git commit -m "feat(cortex): add ingestion pipeline with watcher state tracking"
```

---

## Chunk 3: Retrieval & MCP

### Task 10: Scoring Module

**Files:**
- Create: `src/lib/cortex/retrieval/scoring.ts`
- Create: `tests/lib/cortex/retrieval/scoring.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/retrieval/scoring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeRelevanceScore, computeRecencyBoost, computeStaleScore } from '@/lib/cortex/retrieval/scoring';

describe('scoring', () => {
  it('computes relevance score correctly', () => {
    const score = computeRelevanceScore({
      similarity: 0.9,
      confidence: 0.8,
      stale_score: 0.1,
      created: new Date().toISOString(),
    });
    // similarity(0.9) × confidence(0.8) × (1 - stale(0.1)) × recency_boost(~1.1)
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('recency boost is higher for recent items', () => {
    const recent = computeRecencyBoost(new Date().toISOString());
    const old = computeRecencyBoost(new Date(Date.now() - 30 * 86400000).toISOString());
    expect(recent).toBeGreaterThan(old);
  });

  it('stale score increases with time based on halflife', () => {
    const fresh = computeStaleScore(new Date().toISOString(), 90);
    const stale = computeStaleScore(
      new Date(Date.now() - 180 * 86400000).toISOString(), 90
    );
    expect(fresh).toBeLessThan(0.1);
    expect(stale).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Implement scoring**

Create `src/lib/cortex/retrieval/scoring.ts`:

```typescript
export function computeRelevanceScore(params: {
  similarity: number;
  confidence: number;
  stale_score: number;
  created: string;
}): number {
  const recencyBoost = computeRecencyBoost(params.created);
  return Math.min(
    1.0,
    params.similarity * params.confidence * (1 - params.stale_score) * recencyBoost,
  );
}

export function computeRecencyBoost(created: string): number {
  const ageMs = Date.now() - new Date(created).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Boost items within 7 days by +0.1, decay smoothly after
  if (ageDays <= 7) return 1.1;
  if (ageDays <= 30) return 1.05;
  return 1.0;
}

export function computeStaleScore(
  created: string,
  halflifeDays: number,
): number {
  const ageMs = Date.now() - new Date(created).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Exponential decay: stale_score = 1 - 2^(-age/halflife)
  return 1 - Math.pow(2, -ageDays / halflifeDays);
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run tests/lib/cortex/retrieval/scoring.test.ts
git add src/lib/cortex/retrieval/scoring.ts tests/lib/cortex/retrieval/scoring.test.ts
git commit -m "feat(cortex): add relevance scoring with recency boost and staleness"
```

---

### Task 11: Multi-Layer Vector Search

**Files:**
- Create: `src/lib/cortex/retrieval/search.ts`
- Create: `tests/lib/cortex/retrieval/search.test.ts`

Searches across personal → workspace → team layers with priority weighting, reranks results, and returns top-k.

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/retrieval/search.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CortexSearch, type SearchOptions } from '@/lib/cortex/retrieval/search';

describe('CortexSearch', () => {
  it('searches multiple layers and merges results by score', async () => {
    const mockStore = {
      search: vi.fn()
        .mockResolvedValueOnce([ // personal results
          { id: 'p1', text: 'personal pref', type: 'preference', confidence: 0.9,
            stale_score: 0, created: new Date().toISOString(), layer: 'personal',
            workspace_id: null, session_id: null, agent_type: 'claude',
            project_path: null, file_refs: [], access_count: 0,
            last_accessed: null, metadata: {}, source_timestamp: new Date().toISOString(),
            vector: [], _distance: 0.1 },
        ])
        .mockResolvedValueOnce([ // workspace results
          { id: 'w1', text: 'workspace pattern', type: 'pattern', confidence: 0.8,
            stale_score: 0, created: new Date().toISOString(), layer: 'workspace',
            workspace_id: 1, session_id: null, agent_type: 'claude',
            project_path: null, file_refs: [], access_count: 0,
            last_accessed: null, metadata: {}, source_timestamp: new Date().toISOString(),
            vector: [], _distance: 0.2 },
        ]),
    } as any;

    const search = new CortexSearch(mockStore);
    const results = await search.search(
      [0.1, 0.2, 0.3],
      { workspaceId: 1, limit: 5 },
    );

    expect(results.length).toBe(2);
    // Personal should rank higher (weight 1.0 vs 0.9)
    expect(results[0].id).toBe('p1');
  });
});
```

- [ ] **Step 2: Implement search**

Create `src/lib/cortex/retrieval/search.ts`:

```typescript
import type { CortexStore } from '../store';
import type { KnowledgeUnit, ScoredKnowledge, Layer } from '../knowledge/types';
import { computeRelevanceScore } from './scoring';

const LAYER_WEIGHTS: Record<Layer, number> = {
  personal: 1.0,
  workspace: 0.9,
  team: 0.7,
};

export interface SearchOptions {
  workspaceId?: number | null;
  layers?: Layer[];
  excludeLayers?: Layer[];  // Layers to exclude (e.g., ['personal'] for federation)
  types?: string[];
  limit?: number;
  minConfidence?: number;
}

export class CortexSearch {
  constructor(private store: CortexStore) {}

  async search(
    queryVector: number[],
    options: SearchOptions = {},
  ): Promise<ScoredKnowledge[]> {
    const {
      workspaceId = null,
      layers = ['personal', 'workspace', 'team'],
      excludeLayers = [],
      limit = 5,
      minConfidence = 0.3,
    } = options;

    const allResults: ScoredKnowledge[] = [];
    const activeLayers = layers.filter(l => !excludeLayers.includes(l));

    for (const layer of activeLayers) {
      const layerKey = layer === 'workspace' && workspaceId
        ? `workspace/${workspaceId}`
        : layer;

      try {
        const results = await this.store.search(layerKey, queryVector, limit * 2);
        const weight = LAYER_WEIGHTS[layer] ?? 0.5;

        for (const unit of results) {
          const similarity = 1 - ((unit as any)._distance ?? 0);
          const relevance = computeRelevanceScore({
            similarity,
            confidence: unit.confidence,
            stale_score: unit.stale_score,
            created: unit.created,
          }) * weight;

          if (unit.confidence >= minConfidence) {
            allResults.push({
              ...unit,
              relevance_score: relevance,
              similarity,
            });
          }
        }
      } catch {
        // Layer may not exist yet, skip
      }
    }

    // Sort by relevance, return top-k
    allResults.sort((a, b) => b.relevance_score - a.relevance_score);
    return allResults.slice(0, limit);
  }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
npx vitest run tests/lib/cortex/retrieval/search.test.ts
git add src/lib/cortex/retrieval/search.ts tests/lib/cortex/retrieval/search.test.ts
git commit -m "feat(cortex): add multi-layer vector search with reranking"
```

---

### Task 12: Context Injection Formatter

**Files:**
- Create: `src/lib/cortex/retrieval/injection.ts`
- Create: `tests/lib/cortex/retrieval/injection.test.ts`

Formats search results into the `<cortex-context>` block for prompt injection.

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/retrieval/injection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatCortexContext } from '@/lib/cortex/retrieval/injection';
import type { ScoredKnowledge } from '@/lib/cortex/knowledge/types';

describe('formatCortexContext', () => {
  const makeUnit = (overrides: Partial<ScoredKnowledge> = {}): ScoredKnowledge => ({
    id: 'test-1',
    vector: [],
    text: 'Use JWT for auth',
    type: 'decision',
    layer: 'workspace',
    workspace_id: 1,
    session_id: 'sess-1',
    agent_type: 'claude',
    project_path: '/project',
    file_refs: [],
    confidence: 0.85,
    created: '2026-03-10T00:00:00Z',
    source_timestamp: '2026-03-10T00:00:00Z',
    stale_score: 0,
    access_count: 0,
    last_accessed: null,
    metadata: {},
    relevance_score: 0.9,
    similarity: 0.92,
    ...overrides,
  });

  it('returns empty string for no results', () => {
    expect(formatCortexContext([])).toBe('');
  });

  it('wraps results in cortex-context tags', () => {
    const result = formatCortexContext([makeUnit()]);
    expect(result).toContain('<cortex-context>');
    expect(result).toContain('</cortex-context>');
    expect(result).toContain('[Decision]');
    expect(result).toContain('Use JWT for auth');
  });

  it('respects token budget', () => {
    const units = Array.from({ length: 50 }, (_, i) =>
      makeUnit({ id: `u-${i}`, text: 'A'.repeat(200) })
    );
    const result = formatCortexContext(units, 500);
    // Should not include all 50 units
    const entryCount = (result.match(/\[Decision\]/g) || []).length;
    expect(entryCount).toBeLessThan(50);
  });

  it('formats different knowledge types correctly', () => {
    const result = formatCortexContext([
      makeUnit({ type: 'preference', text: 'No ORMs' }),
      makeUnit({ type: 'error_fix', text: 'Fix ECONNRESET' }),
    ]);
    expect(result).toContain('[Preference]');
    expect(result).toContain('[Error Fix]');
  });
});
```

- [ ] **Step 2: Implement injection formatter**

Create `src/lib/cortex/retrieval/injection.ts`:

```typescript
import type { ScoredKnowledge } from '../knowledge/types';

const TYPE_LABELS: Record<string, string> = {
  decision: 'Decision',
  pattern: 'Pattern',
  preference: 'Preference',
  error_fix: 'Error Fix',
  context: 'Context',
  code_pattern: 'Code',
  command: 'Command',
  conversation: 'Conversation',
  summary: 'Summary',
};

export function formatCortexContext(
  results: ScoredKnowledge[],
  maxTokens = 2000,
): string {
  if (results.length === 0) return '';

  const lines: string[] = ['<cortex-context>', 'Relevant context from your workspace history:', ''];
  let estimatedTokens = 20; // header overhead

  for (const unit of results) {
    const label = TYPE_LABELS[unit.type] || unit.type;
    const date = unit.source_timestamp?.slice(0, 10) || '';
    const confidence = (unit.confidence * 100).toFixed(0);

    let entry = `[${label}]`;
    if (date) entry += ` ${date}:`;
    entry += ` ${unit.text}`;

    if (unit.session_id) {
      entry += `\nSource: session ${unit.session_id}, confidence: ${confidence}%`;
    }

    const entryTokens = Math.ceil(entry.length / 4); // rough token estimate
    if (estimatedTokens + entryTokens > maxTokens) break;

    lines.push(entry);
    lines.push('');
    estimatedTokens += entryTokens;
  }

  lines.push('</cortex-context>');
  return lines.join('\n');
}
```

- [ ] **Step 3: Run test, commit**

```bash
npx vitest run tests/lib/cortex/retrieval/injection.test.ts
git add src/lib/cortex/retrieval/injection.ts tests/lib/cortex/retrieval/injection.test.ts
git commit -m "feat(cortex): add cortex-context injection formatter"
```

---

### Task 13: MCP Server (Tool Definitions)

**Files:**
- Create: `src/lib/cortex/mcp/server.ts`
- Create: `tests/lib/cortex/mcp/server.test.ts`

The MCP server exposes Cortex tools to any MCP-capable agent. This task defines the 4 core tools with placeholder handlers. Task 30 (Chunk 10) wires the handlers to real Cortex instances and adds the remaining 6 tools.

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/mcp/server.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CORTEX_TOOLS, handleToolCall } from '@/lib/cortex/mcp/server';

describe('MCP server', () => {
  it('defines 4 core tools', () => {
    expect(CORTEX_TOOLS).toHaveLength(4);
    const names = CORTEX_TOOLS.map(t => t.name);
    expect(names).toContain('cortex_search');
    expect(names).toContain('cortex_teach');
    expect(names).toContain('cortex_forget');
    expect(names).toContain('cortex_status');
  });

  it('cortex_search requires query param', () => {
    const tool = CORTEX_TOOLS.find(t => t.name === 'cortex_search')!;
    expect(tool.inputSchema.required).toContain('query');
  });

  it('cortex_teach requires text, type, layer', () => {
    const tool = CORTEX_TOOLS.find(t => t.name === 'cortex_teach')!;
    expect(tool.inputSchema.required).toEqual(['text', 'type', 'layer']);
  });

  it('returns error for unknown tool', async () => {
    const result = await handleToolCall('unknown_tool', {}, null);
    expect(result.isError).toBe(true);
  });

  it('handles cortex_status without cortex instance', async () => {
    const result = await handleToolCall('cortex_status', {}, null);
    expect(result.content[0].text).toContain('not initialized');
  });
});
```

- [ ] **Step 2: Implement MCP server**

Create `src/lib/cortex/mcp/server.ts`. This follows the `@modelcontextprotocol/sdk` pattern already used by the project:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CortexInstance } from '../index';

export const CORTEX_TOOLS = [
  {
    name: 'cortex_search',
    description: 'Search the Cortex knowledge base for relevant context. Use at the start of each task to get workspace history.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        layers: { type: 'array', items: { type: 'string' }, description: 'Layers to search: personal, workspace, team' },
        types: { type: 'array', items: { type: 'string' }, description: 'Filter by type: decision, pattern, preference, error_fix, etc.' },
        workspace_id: { type: 'number', description: 'Workspace ID to scope search' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cortex_teach',
    description: 'Explicitly teach the Cortex something. Stored at high confidence (0.95).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Knowledge to store' },
        type: { type: 'string', description: 'Type: decision, pattern, preference, error_fix' },
        layer: { type: 'string', description: 'Layer: personal, workspace, team' },
        workspace_id: { type: 'number', description: 'Workspace ID if workspace layer' },
      },
      required: ['text', 'type', 'layer'],
    },
  },
  {
    name: 'cortex_forget',
    description: 'Remove or downrank knowledge from the Cortex.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Knowledge unit ID to forget' },
        action: { type: 'string', enum: ['delete', 'downrank'], description: 'Delete or just downrank' },
      },
      required: ['id'],
    },
  },
  {
    name: 'cortex_status',
    description: 'Get Cortex health and statistics.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

/** Handle a single tool call. Exported for testing. */
export async function handleToolCall(
  name: string,
  args: Record<string, any>,
  cortex: CortexInstance | null,
) {
  if (!cortex) {
    if (name === 'cortex_status') {
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'not initialized' }) }] };
    }
    return { content: [{ type: 'text', text: 'Cortex not initialized' }], isError: true };
  }

  switch (name) {
    case 'cortex_search': {
      // Wired to real implementation in Task 30
      const [queryVector] = await cortex.embedding.embed([args.query]);
      const results = await cortex.search.search(queryVector, {
        workspaceId: args.workspace_id ?? null,
        limit: args.limit ?? 5,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    }
    case 'cortex_teach': {
      const crypto = await import('crypto');
      const [vector] = await cortex.embedding.embed([args.text]);
      const layerKey = args.layer === 'workspace' && args.workspace_id
        ? `workspace/${args.workspace_id}` : args.layer;
      await cortex.store.add(layerKey, {
        id: crypto.randomUUID(), vector, text: args.text, type: args.type,
        layer: args.layer, workspace_id: args.workspace_id ?? null,
        session_id: null, agent_type: 'claude', project_path: null,
        file_refs: [], confidence: 0.95,
        created: new Date().toISOString(), source_timestamp: new Date().toISOString(),
        stale_score: 0, access_count: 0, last_accessed: null,
        metadata: { source: 'mcp_teach' },
      });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    }
    case 'cortex_forget': {
      const action = args.action ?? 'delete';
      if (action === 'delete') {
        for (const layer of ['personal', 'workspace', 'team']) {
          await cortex.store.delete(layer, args.id);
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    }
    case 'cortex_status': {
      const stats = await cortex.store.stats();
      return { content: [{ type: 'text', text: JSON.stringify({
        status: 'healthy', embedding: cortex.embedding.name, layers: stats,
      }) }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

export function createCortexMCPServer(getCortexFn: () => Promise<CortexInstance | null>) {
  const server = new Server(
    { name: 'spaces-cortex', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: CORTEX_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const cortex = await getCortexFn();
    return handleToolCall(name, args || {}, cortex);
  });

  return server;
}

/** Start the MCP server on stdio transport. */
export async function startCortexMCP(getCortexFn: () => Promise<CortexInstance | null>) {
  const server = createCortexMCPServer(getCortexFn);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 3: Run test, commit**

```bash
npx vitest run tests/lib/cortex/mcp/server.test.ts
git add src/lib/cortex/mcp/ tests/lib/cortex/mcp/
git commit -m "feat(cortex): add MCP server with 4 core tools and handler tests"
```

---

## Chunk 4: API Routes

### Task 14: Cortex Tier Gate and Status Route

**Files:**
- Create: `src/app/api/cortex/status/route.ts`
- Create: `src/lib/cortex/index.ts` — Cortex singleton

Every Cortex API route must check `HAS_CORTEX` before responding. Start with the status route + the singleton.

- [ ] **Step 1: Create the Cortex singleton**

Create `src/lib/cortex/index.ts`:

```typescript
import { HAS_CORTEX, IS_FEDERATION } from '@/lib/tier';
import { getUserPaths } from '@/lib/config';
import { getCurrentUser } from '@/lib/auth';
import { CortexStore } from './store';
import { readCortexConfig, type CortexConfig } from './config';
import { detectProvider, type EmbeddingProvider } from './embeddings';
import { CortexSearch } from './retrieval/search';
import { IngestionPipeline } from './ingestion/pipeline';
import path from 'path';

let _instance: CortexInstance | null = null;

export interface CortexInstance {
  config: CortexConfig;
  store: CortexStore;
  search: CortexSearch;
  pipeline: IngestionPipeline;
  embedding: EmbeddingProvider;
}

export function isCortexAvailable(): boolean {
  return HAS_CORTEX;
}

export async function getCortex(): Promise<CortexInstance | null> {
  if (!HAS_CORTEX) return null;

  if (_instance) return _instance;

  const username = getCurrentUser();
  const { spacesDir, configPath } = getUserPaths(username);
  const config = readCortexConfig(configPath);

  if (!config.enabled) return null;

  const cortexDir = path.join(spacesDir, 'cortex');
  const store = new CortexStore(cortexDir);
  const embedding = await detectProvider(config.embedding.provider);
  await store.init(embedding.dimensions);

  const search = new CortexSearch(store);
  const pipeline = new IngestionPipeline(embedding, store);

  _instance = { config, store, search, pipeline, embedding };
  return _instance;
}

/** Reset singleton (for testing or config changes). */
export function resetCortex(): void {
  _instance = null;
}
```

- [ ] **Step 2: Create the status API route**

Create `src/app/api/cortex/status/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json(
        { error: 'Cortex is not available on the Community tier' },
        { status: 403 },
      );
    }

    const cortex = await getCortex();
    if (!cortex) {
      return NextResponse.json({ enabled: false, status: 'disabled' });
    }

    const stats = await cortex.store.stats();
    return NextResponse.json({
      enabled: true,
      status: 'healthy',
      embedding_provider: cortex.embedding.name,
      embedding_dimensions: cortex.embedding.dimensions,
      layers: stats,
    });
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/cortex/index.ts src/app/api/cortex/status/route.ts
git commit -m "feat(cortex): add Cortex singleton and status API route with tier gate"
```

---

### Task 15: Search and Knowledge CRUD Routes

**Files:**
- Create: `src/app/api/cortex/search/route.ts`
- Create: `src/app/api/cortex/knowledge/route.ts`
- Create: `src/app/api/cortex/knowledge/[id]/route.ts`
- Create: `src/app/api/cortex/settings/route.ts`

- [ ] **Step 1: Create search route**

Create `src/app/api/cortex/search/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ results: [] });

    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const workspaceId = url.searchParams.get('workspace_id');
    const limit = parseInt(url.searchParams.get('limit') || '5', 10);

    if (!query) {
      return NextResponse.json({ error: 'Query parameter "q" required' }, { status: 400 });
    }

    // Embed the query
    const [queryVector] = await cortex.embedding.embed([query]);

    const results = await cortex.search.search(queryVector, {
      workspaceId: workspaceId ? parseInt(workspaceId, 10) : null,
      limit,
    });

    return NextResponse.json({ results });
  });
}
```

- [ ] **Step 2: Create knowledge CRUD route (POST = teach)**

Create `src/app/api/cortex/knowledge/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { isValidKnowledgeType, isValidLayer } from '@/lib/cortex/knowledge/types';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const { text, type, layer, workspace_id } = body;

    if (!text || !type || !layer) {
      return NextResponse.json({ error: 'text, type, and layer required' }, { status: 400 });
    }
    if (!isValidKnowledgeType(type)) {
      return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 });
    }
    if (!isValidLayer(layer)) {
      return NextResponse.json({ error: `Invalid layer: ${layer}` }, { status: 400 });
    }

    const [vector] = await cortex.embedding.embed([text]);
    const id = crypto.randomUUID();
    const layerKey = layer === 'workspace' && workspace_id
      ? `workspace/${workspace_id}` : layer;

    await cortex.store.add(layerKey, {
      id,
      vector,
      text,
      type,
      layer,
      workspace_id: workspace_id || null,
      session_id: null,
      agent_type: 'claude',
      project_path: null,
      file_refs: [],
      confidence: 0.95, // User-taught = high confidence
      created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(),
      stale_score: 0,
      access_count: 0,
      last_accessed: null,
      metadata: { source: 'user_teach' },
    });

    return NextResponse.json({ id, success: true });
  });
}
```

- [ ] **Step 3: Create knowledge/:id route**

Create `src/app/api/cortex/knowledge/[id]/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { id } = await params;

    // Search all layers for this unit
    for (const layer of ['personal', 'workspace', 'team']) {
      const results = await cortex.store.search(layer, [], 1, `id = '${id.replace(/'/g, "''")}'`);
      if (results.length > 0) {
        return NextResponse.json(results[0]);
      }
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { id } = await params;
    const updates = await request.json();

    // LanceDB doesn't support in-place updates natively.
    // Strategy: find the unit, delete it, re-add with merged fields.
    for (const layer of ['personal', 'workspace', 'team']) {
      const safeId = id.replace(/'/g, "''");
      const results = await cortex.store.search(layer, [], 1, `id = '${safeId}'`);
      if (results.length > 0) {
        const existing = results[0];
        await cortex.store.delete(layer, id);
        const merged = {
          ...existing,
          ...updates,
          id, // preserve original ID
        };
        // Re-embed if layer changed
        const targetLayer = merged.layer === 'workspace' && merged.workspace_id
          ? `workspace/${merged.workspace_id}` : merged.layer;
        await cortex.store.add(targetLayer, merged);
        return NextResponse.json({ success: true });
      }
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { id } = await params;

    // Try deleting from all layers
    for (const layer of ['personal', 'workspace', 'team']) {
      await cortex.store.delete(layer, id);
    }

    return NextResponse.json({ success: true });
  });
}
```

- [ ] **Step 4: Create settings route**

Create `src/app/api/cortex/settings/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';
import { isCortexAvailable } from '@/lib/cortex';
import { readCortexConfig, writeCortexConfig } from '@/lib/cortex/config';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const { configPath } = getUserPaths(user);
    const config = readCortexConfig(configPath);
    return NextResponse.json(config);
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const { configPath } = getUserPaths(user);
    const updates = await request.json();
    writeCortexConfig(configPath, updates);
    return NextResponse.json({ success: true });
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cortex/
git commit -m "feat(cortex): add search, knowledge CRUD, and settings API routes"
```

---

### Task 16: Bootstrap Ingestion Route

**Files:**
- Create: `src/lib/cortex/ingestion/bootstrap.ts`
- Create: `src/app/api/cortex/ingest/bootstrap/route.ts`
- Create: `src/app/api/cortex/ingest/status/route.ts`

- [ ] **Step 1: Implement bootstrap ingestion**

Create `src/lib/cortex/ingestion/bootstrap.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { getUserPaths } from '@/lib/config';
import { getCurrentUser } from '@/lib/auth';
import type { IngestionPipeline } from './pipeline';
import type { SessionMessage } from './chunker';
import { IngestionWatcher } from './watcher';

export interface BootstrapProgress {
  status: 'idle' | 'running' | 'complete' | 'error';
  totalFiles: number;
  processedFiles: number;
  totalChunks: number;
  errors: string[];
}

let _progress: BootstrapProgress = {
  status: 'idle', totalFiles: 0, processedFiles: 0, totalChunks: 0, errors: [],
};

export function getBootstrapProgress(): BootstrapProgress {
  return { ..._progress };
}

export async function runBootstrap(
  pipeline: IngestionPipeline,
  cortexDir: string,
): Promise<BootstrapProgress> {
  const username = getCurrentUser();
  const paths = getUserPaths(username);
  const watcher = new IngestionWatcher(cortexDir);

  _progress = { status: 'running', totalFiles: 0, processedFiles: 0, totalChunks: 0, errors: [] };

  // Find all JSONL session files
  const sessionFiles = findSessionFiles(paths.claudeProjectsDir);
  _progress.totalFiles = sessionFiles.length;

  for (const file of sessionFiles) {
    try {
      if (!watcher.needsSync(file.path)) {
        _progress.processedFiles++;
        continue;
      }

      const messages = parseJSONLFile(file.path);
      if (messages.length === 0) {
        _progress.processedFiles++;
        continue;
      }

      const result = await pipeline.ingest(messages, {
        sessionId: file.sessionId,
        workspaceId: null, // Bootstrap doesn't know workspace mapping yet
        agentType: 'claude',
        projectPath: file.projectPath,
      });

      _progress.totalChunks += result.chunksEmbedded;
      _progress.errors.push(...result.errors);

      watcher.markSynced(file.path, fs.statSync(file.path).size);
      _progress.processedFiles++;
    } catch (err) {
      _progress.errors.push(`Failed to process ${file.path}: ${err}`);
      _progress.processedFiles++;
    }
  }

  watcher.save();
  _progress.status = _progress.errors.length > 0 ? 'error' : 'complete';
  return { ..._progress };
}

interface SessionFile {
  path: string;
  sessionId: string;
  projectPath: string | null;
}

function findSessionFiles(claudeProjectsDir: string): SessionFile[] {
  const files: SessionFile[] = [];
  if (!fs.existsSync(claudeProjectsDir)) return files;

  const projects = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const project of projects) {
    const projectDir = path.join(claudeProjectsDir, project.name);
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push({
          path: path.join(projectDir, entry.name),
          sessionId: entry.name.replace('.jsonl', ''),
          projectPath: decodeURIComponent(project.name),
        });
      }
    }
  }

  return files;
}

function parseJSONLFile(filePath: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'human' || entry.type === 'assistant') {
          const text = typeof entry.message?.content === 'string'
            ? entry.message.content
            : Array.isArray(entry.message?.content)
              ? entry.message.content
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text)
                  .join('\n')
              : '';

          if (text) {
            messages.push({
              role: entry.type,
              content: text,
              timestamp: entry.timestamp || new Date().toISOString(),
              hasToolUse: Array.isArray(entry.message?.content) &&
                entry.message.content.some((b: any) => b.type === 'tool_use'),
            });
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* skip unreadable files */ }
  return messages;
}
```

- [ ] **Step 2: Create bootstrap API routes**

Create `src/app/api/cortex/ingest/bootstrap/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { runBootstrap } from '@/lib/cortex/ingestion/bootstrap';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { spacesDir } = getUserPaths(user);
    const cortexDir = path.join(spacesDir, 'cortex');

    // Run bootstrap asynchronously
    runBootstrap(cortex.pipeline, cortexDir).catch(err => {
      console.error('Bootstrap error:', err);
    });

    return NextResponse.json({ status: 'started' });
  });
}
```

Create `src/app/api/cortex/ingest/status/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable } from '@/lib/cortex';
import { getBootstrapProgress } from '@/lib/cortex/ingestion/bootstrap';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    return NextResponse.json(getBootstrapProgress());
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/cortex/ingestion/bootstrap.ts src/app/api/cortex/ingest/
git commit -m "feat(cortex): add bootstrap ingestion with progress tracking"
```

---

## Chunk 5: Staleness, Contradiction, and Distillation

### Task 17: Staleness Detection

**Files:**
- Create: `src/lib/cortex/knowledge/staleness.ts`
- Create: `tests/lib/cortex/knowledge/staleness.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/knowledge/staleness.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeFileStaleScore, computeTimeDecay } from '@/lib/cortex/knowledge/staleness';

describe('staleness', () => {
  it('returns 0 for recently created knowledge with no file changes', () => {
    const score = computeFileStaleScore({
      fileRefs: ['src/auth.ts'],
      sourceTimestamp: new Date().toISOString(),
      fileModTimes: { 'src/auth.ts': new Date().toISOString() },
    });
    expect(score).toBe(0);
  });

  it('returns >0 when referenced file was modified after knowledge creation', () => {
    const created = new Date('2026-01-01').toISOString();
    const modified = new Date('2026-03-10').toISOString();
    const score = computeFileStaleScore({
      fileRefs: ['src/auth.ts'],
      sourceTimestamp: created,
      fileModTimes: { 'src/auth.ts': modified },
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0 when no file refs', () => {
    const score = computeFileStaleScore({
      fileRefs: [],
      sourceTimestamp: new Date().toISOString(),
      fileModTimes: {},
    });
    expect(score).toBe(0);
  });

  it('computes time decay with halflife', () => {
    const now = Date.now();
    // Knowledge created exactly one halflife ago should decay to ~0.5
    const halflifeDays = 90;
    const created = new Date(now - halflifeDays * 24 * 60 * 60 * 1000).toISOString();
    const decay = computeTimeDecay(created, halflifeDays);
    expect(decay).toBeCloseTo(0.5, 1);
  });

  it('returns ~1 for very old knowledge', () => {
    const created = new Date('2020-01-01').toISOString();
    const decay = computeTimeDecay(created, 30);
    expect(decay).toBeGreaterThan(0.95);
  });

  it('returns ~0 for very recent knowledge', () => {
    const decay = computeTimeDecay(new Date().toISOString(), 180);
    expect(decay).toBeCloseTo(0, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/cortex/knowledge/staleness.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement staleness detection**

Create `src/lib/cortex/knowledge/staleness.ts`:

```typescript
export interface FileStaleInput {
  fileRefs: string[];
  sourceTimestamp: string;
  fileModTimes: Record<string, string>; // filePath → ISO timestamp
}

/**
 * Compute file-based staleness score (0–1).
 * If referenced files were modified after the knowledge was created,
 * the knowledge may be stale.
 */
export function computeFileStaleScore(input: FileStaleInput): number {
  if (input.fileRefs.length === 0) return 0;

  const sourceTime = new Date(input.sourceTimestamp).getTime();
  let maxStaleness = 0;

  for (const ref of input.fileRefs) {
    const modTime = input.fileModTimes[ref];
    if (!modTime) continue;
    const modMs = new Date(modTime).getTime();
    if (modMs > sourceTime) {
      // File was modified after knowledge was created
      const daysSince = (modMs - sourceTime) / (1000 * 60 * 60 * 24);
      // Sigmoid: approaches 1 as days increase
      const staleness = 1 - Math.exp(-daysSince / 30);
      maxStaleness = Math.max(maxStaleness, staleness);
    }
  }

  return Math.min(maxStaleness, 1);
}

/**
 * Compute time-based decay (0–1).
 * Uses exponential decay with configurable halflife.
 * Returns 0 for brand new, approaches 1 for very old.
 */
export function computeTimeDecay(createdTimestamp: string, halflifeDays: number): number {
  const ageMs = Date.now() - new Date(createdTimestamp).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Exponential decay: 1 - e^(-ln(2) * age / halflife)
  return 1 - Math.pow(2, -ageDays / halflifeDays);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/cortex/knowledge/staleness.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/knowledge/staleness.ts tests/lib/cortex/knowledge/staleness.test.ts
git commit -m "feat(cortex): add staleness detection with file modification tracking"
```

---

### Task 18: Contradiction Detection

**Files:**
- Create: `src/lib/cortex/knowledge/contradiction.ts`
- Create: `tests/lib/cortex/knowledge/contradiction.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/knowledge/contradiction.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectContradictions, cosineSimilarity } from '@/lib/cortex/knowledge/contradiction';
import type { KnowledgeUnit } from '@/lib/cortex/knowledge/types';

describe('contradiction detection', () => {
  const makeUnit = (id: string, text: string, vector: number[]): KnowledgeUnit => ({
    id, vector, text, type: 'decision', layer: 'workspace',
    workspace_id: 1, session_id: null, agent_type: 'claude',
    project_path: null, file_refs: [], confidence: 0.8,
    created: new Date().toISOString(),
    source_timestamp: new Date().toISOString(),
    stale_score: 0, access_count: 0, last_accessed: null, metadata: {},
  });

  it('cosine similarity of identical vectors is 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('cosine similarity of orthogonal vectors is 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('detects no contradictions when vectors are dissimilar', () => {
    const newUnit = makeUnit('new', 'Use REST', [1, 0, 0]);
    const existing = [makeUnit('old', 'Use GraphQL', [0, 1, 0])];
    const contradictions = detectContradictions(newUnit, existing, 0.8);
    expect(contradictions).toHaveLength(0);
  });

  it('flags contradiction when vectors are similar but from different times', () => {
    const vec = [0.9, 0.1, 0.0];
    const newUnit = makeUnit('new', 'Use Zod v4', vec);
    const old = makeUnit('old', 'Use Zod v3', vec);
    old.created = new Date('2025-01-01').toISOString();
    const contradictions = detectContradictions(newUnit, [old], 0.8);
    expect(contradictions).toHaveLength(1);
    expect(contradictions[0].existingId).toBe('old');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/lib/cortex/knowledge/contradiction.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement contradiction detection**

Create `src/lib/cortex/knowledge/contradiction.ts`:

```typescript
import type { KnowledgeUnit } from './types';

export interface Contradiction {
  existingId: string;
  existingText: string;
  similarity: number;
  existingCreated: string;
}

/** Compute cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

/**
 * Detect contradictions between a new knowledge unit and existing units.
 *
 * A contradiction is flagged when:
 * 1. Two units have high vector similarity (>= threshold) — they discuss the same topic
 * 2. They are of the same knowledge type (e.g., both decisions)
 * 3. They were created at different times (newer may supersede older)
 *
 * Returns contradiction candidates sorted by similarity (highest first).
 */
export function detectContradictions(
  newUnit: KnowledgeUnit,
  existingUnits: KnowledgeUnit[],
  similarityThreshold = 0.85,
): Contradiction[] {
  const contradictions: Contradiction[] = [];

  for (const existing of existingUnits) {
    // Skip self
    if (existing.id === newUnit.id) continue;
    // Only compare same type
    if (existing.type !== newUnit.type) continue;

    const similarity = cosineSimilarity(newUnit.vector, existing.vector);
    if (similarity >= similarityThreshold) {
      // High similarity + different creation time = potential contradiction
      if (existing.created !== newUnit.created) {
        contradictions.push({
          existingId: existing.id,
          existingText: existing.text,
          similarity,
          existingCreated: existing.created,
        });
      }
    }
  }

  return contradictions.sort((a, b) => b.similarity - a.similarity);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/lib/cortex/knowledge/contradiction.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/knowledge/contradiction.ts tests/lib/cortex/knowledge/contradiction.test.ts
git commit -m "feat(cortex): add contradiction detection between knowledge units"
```

---

### Task 19: Distillation Prompts and Scheduler

**Files:**
- Create: `src/lib/cortex/distillation/prompts.ts`
- Create: `src/lib/cortex/distillation/scheduler.ts`
- Create: `src/lib/cortex/distillation/distiller.ts`

- [ ] **Step 1: Create distillation prompts**

Create `src/lib/cortex/distillation/prompts.ts`:

```typescript
import type { KnowledgeType } from '../knowledge/types';

export interface DistillationPrompt {
  systemPrompt: string;
  userTemplate: (chunks: string[]) => string;
  outputType: KnowledgeType;
}

const EXTRACTION_SYSTEM = `You are a knowledge extraction system. Analyze conversation chunks and extract structured knowledge units. Return JSON arrays only.`;

export const PROMPTS: Record<string, DistillationPrompt> = {
  decisions: {
    systemPrompt: EXTRACTION_SYSTEM,
    userTemplate: (chunks) => `Analyze these conversation chunks and extract any explicit DECISIONS made. A decision is a deliberate choice about architecture, technology, approach, or design.

Return a JSON array of objects with: { "text": "what was decided", "rationale": "why", "confidence": 0.0-1.0 }

Return [] if no decisions found.

Chunks:
${chunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c}`).join('\n\n')}`,
    outputType: 'decision',
  },
  patterns: {
    systemPrompt: EXTRACTION_SYSTEM,
    userTemplate: (chunks) => `Analyze these conversation chunks and extract recurring PATTERNS — approaches, conventions, or techniques used repeatedly.

Return a JSON array of objects with: { "text": "the pattern", "occurrences": number, "confidence": 0.0-1.0 }

Return [] if no patterns found.

Chunks:
${chunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c}`).join('\n\n')}`,
    outputType: 'pattern',
  },
  preferences: {
    systemPrompt: EXTRACTION_SYSTEM,
    userTemplate: (chunks) => `Analyze these conversation chunks and extract user PREFERENCES — corrections, style choices, or explicit "do this, not that" instructions.

Return a JSON array of objects with: { "text": "the preference", "confidence": 0.0-1.0 }

Return [] if no preferences found.

Chunks:
${chunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c}`).join('\n\n')}`,
    outputType: 'preference',
  },
  error_fixes: {
    systemPrompt: EXTRACTION_SYSTEM,
    userTemplate: (chunks) => `Analyze these conversation chunks and extract ERROR/FIX pairs — errors encountered and their solutions.

Return a JSON array of objects with: { "error": "what went wrong", "fix": "how it was resolved", "text": "error: X, fix: Y", "confidence": 0.0-1.0 }

Return [] if no error/fix pairs found.

Chunks:
${chunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c}`).join('\n\n')}`,
    outputType: 'error_fix',
  },
};
```

- [ ] **Step 2: Create scheduler**

Create `src/lib/cortex/distillation/scheduler.ts`:

```typescript
/**
 * Idle-time scheduler for Tier 3 distillation.
 * Batches recent raw chunks and triggers distillation during quiet periods.
 */
export class DistillationScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingChunkIds: string[] = [];
  private running = false;
  private idleDelayMs: number;

  constructor(
    private onDistill: (chunkIds: string[]) => Promise<void>,
    idleDelayMs = 30_000, // Wait 30s of idle before distilling
  ) {
    this.idleDelayMs = idleDelayMs;
  }

  /** Queue chunk IDs for distillation. Resets the idle timer. */
  enqueue(chunkIds: string[]): void {
    this.pendingChunkIds.push(...chunkIds);
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.idleDelayMs);
  }

  private async flush(): Promise<void> {
    if (this.running || this.pendingChunkIds.length === 0) return;
    this.running = true;

    const batch = this.pendingChunkIds.splice(0, 50); // Process 50 at a time
    try {
      await this.onDistill(batch);
    } catch (err) {
      console.error('[Cortex] Distillation error:', err);
      // Re-queue failed batch for retry
      this.pendingChunkIds.unshift(...batch);
    } finally {
      this.running = false;
      // If more pending, schedule again
      if (this.pendingChunkIds.length > 0) {
        this.resetTimer();
      }
    }
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Get number of pending chunks. */
  get pendingCount(): number {
    return this.pendingChunkIds.length;
  }
}
```

- [ ] **Step 3: Create distiller**

Create `src/lib/cortex/distillation/distiller.ts`:

```typescript
import crypto from 'crypto';
import type { CortexStore } from '../store';
import type { EmbeddingProvider } from '../embeddings';
import type { KnowledgeUnit } from '../knowledge/types';
import { PROMPTS, type DistillationPrompt } from './prompts';

export interface DistillationResult {
  unitsCreated: number;
  errors: string[];
}

/**
 * Tier 3 distiller: takes raw conversation chunks from LanceDB,
 * passes them through an LLM to extract structured knowledge,
 * then embeds and stores the results at higher confidence.
 */
export class Distiller {
  constructor(
    private store: CortexStore,
    private embedding: EmbeddingProvider,
    private callLLM: (system: string, user: string) => Promise<string>,
  ) {}

  /**
   * Distill a batch of raw chunk IDs.
   * Reads their text from the store, runs each prompt type,
   * stores extracted knowledge.
   */
  async distill(
    chunkTexts: string[],
    layerKey: string,
    context: { workspaceId: number | null; agentType: string },
  ): Promise<DistillationResult> {
    const result: DistillationResult = { unitsCreated: 0, errors: [] };
    if (chunkTexts.length === 0) return result;

    // Run each extraction prompt
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      try {
        const userMessage = prompt.userTemplate(chunkTexts);
        const response = await this.callLLM(prompt.systemPrompt, userMessage);

        // Parse JSON response
        let extracted: any[];
        try {
          extracted = JSON.parse(response);
          if (!Array.isArray(extracted)) extracted = [];
        } catch {
          result.errors.push(`Failed to parse ${name} response as JSON`);
          continue;
        }

        // Embed and store each extracted unit
        for (const item of extracted) {
          const text = item.text || '';
          if (!text) continue;

          const [vector] = await this.embedding.embed([text]);
          const unit: KnowledgeUnit = {
            id: crypto.randomUUID(),
            vector,
            text,
            type: prompt.outputType,
            layer: layerKey.startsWith('workspace/') ? 'workspace' : 'personal',
            workspace_id: context.workspaceId,
            session_id: null,
            agent_type: context.agentType as any,
            project_path: null,
            file_refs: [],
            confidence: (item.confidence ?? 0.8) * 1.0, // Distilled = higher base
            created: new Date().toISOString(),
            source_timestamp: new Date().toISOString(),
            stale_score: 0,
            access_count: 0,
            last_accessed: null,
            metadata: { source: 'distillation', prompt_type: name },
          };

          await this.store.add(layerKey, unit);
          result.unitsCreated++;
        }
      } catch (err) {
        result.errors.push(`Distillation ${name} failed: ${err}`);
      }
    }

    return result;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/distillation/
git commit -m "feat(cortex): add Tier 3 distillation with prompts, scheduler, and distiller"
```

---

## Chunk 6: UI Components

### Task 20: Cortex Indicator (Top Bar Badge)

**Files:**
- Create: `src/components/cortex/cortex-indicator.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Create the indicator component**

Create `src/components/cortex/cortex-indicator.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Brain } from 'lucide-react';
import { useTier } from '@/hooks/use-tier';
import { api } from '@/lib/api';

export function CortexIndicator({ onClick }: { onClick?: () => void }) {
  const { hasCortex } = useTier();
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    if (!hasCortex) return;
    const fetchStatus = async () => {
      try {
        const res = await fetch(api('/api/cortex/status'));
        if (res.ok) setStatus(await res.json());
      } catch { /* ignore */ }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [hasCortex]);

  if (!hasCortex || !status?.enabled) return null;

  const totalUnits = Object.values(status.layers || {}).reduce(
    (sum: number, layer: any) => sum + (layer.count || 0), 0
  );

  const color = status.status === 'healthy' ? 'text-purple-400' : 'text-red-400';

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/5 transition-colors ${color}`}
      title={`Cortex: ${totalUnits} knowledge units`}
    >
      <Brain className="w-4 h-4" />
      <span className="text-xs tabular-nums">{totalUnits}</span>
    </button>
  );
}
```

- [ ] **Step 2: Add to sidebar**

In `src/components/layout/sidebar.tsx`, import and render `CortexIndicator` near the bottom of the sidebar, above the logout button. Gate with `hasCortex` from `useTier()`.

- [ ] **Step 3: Commit**

```bash
git add src/components/cortex/cortex-indicator.tsx src/components/layout/sidebar.tsx
git commit -m "feat(cortex): add Cortex indicator badge in sidebar"
```

---

### Task 21: Cortex Panel (Slide-out Knowledge Explorer)

**Files:**
- Create: `src/components/cortex/cortex-panel.tsx`
- Create: `src/components/cortex/knowledge-card.tsx`

- [ ] **Step 1: Create knowledge card**

Create `src/components/cortex/knowledge-card.tsx`:

```typescript
'use client';

import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';

const TYPE_COLORS: Record<string, string> = {
  decision: 'bg-blue-500/20 text-blue-400',
  preference: 'bg-pink-500/20 text-pink-400',
  pattern: 'bg-green-500/20 text-green-400',
  error_fix: 'bg-amber-500/20 text-amber-400',
  context: 'bg-gray-500/20 text-gray-400',
  code_pattern: 'bg-cyan-500/20 text-cyan-400',
  command: 'bg-orange-500/20 text-orange-400',
  conversation: 'bg-slate-500/20 text-slate-400',
  summary: 'bg-violet-500/20 text-violet-400',
};

interface KnowledgeCardProps {
  unit: {
    id: string;
    text: string;
    type: string;
    confidence: number;
    created: string;
    session_id?: string | null;
    layer: string;
  };
  onDelete?: (id: string) => void;
}

export function KnowledgeCard({ unit, onDelete }: KnowledgeCardProps) {
  const colorClass = TYPE_COLORS[unit.type] || TYPE_COLORS.context;
  const age = getRelativeAge(unit.created);
  const confidencePct = Math.round(unit.confidence * 100);

  const handleDelete = async () => {
    await fetch(api(`/api/cortex/knowledge/${unit.id}`), { method: 'DELETE' });
    onDelete?.(unit.id);
  };

  return (
    <div className="group border border-white/5 rounded-lg p-3 hover:border-white/10 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colorClass}`}>
          {unit.type.replace('_', ' ')}
        </span>
        <div className="flex items-center gap-2 text-[10px] text-gray-500">
          <span>{age}</span>
          <button
            onClick={handleDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-300 mt-1.5 leading-relaxed">{unit.text}</p>
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-500/50 rounded-full"
            style={{ width: `${confidencePct}%` }}
          />
        </div>
        <span className="text-[10px] text-gray-500 tabular-nums">{confidencePct}%</span>
      </div>
    </div>
  );
}

function getRelativeAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
```

- [ ] **Step 2: Create cortex panel**

Create `src/components/cortex/cortex-panel.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Search, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { KnowledgeCard } from './knowledge-card';

interface CortexPanelProps {
  open: boolean;
  onClose: () => void;
}

type LayerTab = 'personal' | 'workspace' | 'team';

export function CortexPanel({ open, onClose }: CortexPanelProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<LayerTab>('workspace');
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(api('/api/cortex/status'));
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) fetchStats();
  }, [open, fetchStats]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(api(`/api/cortex/search?q=${encodeURIComponent(query)}&limit=20`));
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  };

  const handleDelete = (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
    fetchStats();
  };

  if (!open) return null;

  const tabs: LayerTab[] = ['personal', 'workspace', 'team'];
  const filtered = results.filter(r => r.layer === activeTab);

  return (
    <div className="fixed right-0 top-0 bottom-0 w-96 bg-gray-950 border-l border-white/10 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/5">
        <h2 className="text-sm font-medium text-gray-200">Cortex</h2>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex gap-4 px-4 py-2 text-[10px] text-gray-500 border-b border-white/5">
          {Object.entries(stats.layers || {}).map(([layer, data]: [string, any]) => (
            <span key={layer}>{layer}: {data.count}</span>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="p-3 border-b border-white/5">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search knowledge..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-md text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50"
            />
          </div>
        </div>
      </div>

      {/* Layer tabs */}
      <div className="flex border-b border-white/5">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              activeTab === tab
                ? 'text-purple-400 border-b-2 border-purple-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && <p className="text-xs text-gray-500 text-center py-4">Searching...</p>}
        {!loading && filtered.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">
            {query ? 'No results' : 'Search to explore knowledge'}
          </p>
        )}
        {filtered.map(unit => (
          <KnowledgeCard key={unit.id} unit={unit} onDelete={handleDelete} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/cortex/knowledge-card.tsx src/components/cortex/cortex-panel.tsx
git commit -m "feat(cortex): add Cortex panel and knowledge card components"
```

---

### Task 22: Cortex Settings Section

**Files:**
- Create: `src/components/cortex/cortex-settings.tsx`
- Modify: `src/app/(desktop)/settings/page.tsx`

- [ ] **Step 1: Create settings component**

Create `src/components/cortex/cortex-settings.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function CortexSettings() {
  const [config, setConfig] = useState<any>(null);
  const [bootstrapStatus, setBootstrapStatus] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(api('/api/cortex/settings')).then(r => r.json()).then(setConfig).catch(() => {});
  }, []);

  const save = async (updates: Record<string, any>) => {
    setSaving(true);
    await fetch(api('/api/cortex/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    setConfig((prev: any) => ({ ...prev, ...updates }));
    setSaving(false);
  };

  const triggerBootstrap = async () => {
    await fetch(api('/api/cortex/ingest/bootstrap'), { method: 'POST' });
    // Poll for progress
    const poll = setInterval(async () => {
      const res = await fetch(api('/api/cortex/ingest/status'));
      const data = await res.json();
      setBootstrapStatus(data);
      if (data.status === 'complete' || data.status === 'error') {
        clearInterval(poll);
      }
    }, 2000);
  };

  if (!config) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-gray-200">Cortex</h3>

      {/* Enable/disable */}
      <label className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Enable Cortex</span>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={e => save({ enabled: e.target.checked })}
          className="accent-purple-500"
        />
      </label>

      {/* Embedding provider */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Embedding provider</span>
        <span className="text-xs text-gray-300">{config.embedding?.provider || 'auto'}</span>
      </div>

      {/* Injection token budget */}
      <label className="block">
        <span className="text-xs text-gray-400">Injection token budget</span>
        <input
          type="range"
          min={500}
          max={5000}
          step={100}
          value={config.injection?.max_tokens || 2000}
          onChange={e => save({ injection: { max_tokens: parseInt(e.target.value) } })}
          className="w-full mt-1"
        />
        <span className="text-[10px] text-gray-500">{config.injection?.max_tokens || 2000} tokens</span>
      </label>

      {/* Distillation toggle */}
      <label className="flex items-center justify-between">
        <span className="text-xs text-gray-400">LLM distillation</span>
        <input
          type="checkbox"
          checked={config.ingestion?.distillation ?? true}
          onChange={e => save({ ingestion: { distillation: e.target.checked } })}
          className="accent-purple-500"
        />
      </label>

      {/* Federation sync mode */}
      <label className="block">
        <span className="text-xs text-gray-400">Federation sync mode</span>
        <select
          value={config.federation?.sync_mode || 'query-only'}
          onChange={e => save({ federation: { sync_mode: e.target.value } })}
          className="w-full mt-1 text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-300"
        >
          <option value="query-only">Query Only</option>
          <option value="background-sync">Background Sync</option>
          <option value="real-time-sync">Real-time Sync</option>
        </select>
      </label>

      {/* Bootstrap */}
      <div className="pt-2 border-t border-white/5">
        <button
          onClick={triggerBootstrap}
          disabled={bootstrapStatus?.status === 'running'}
          className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-50"
        >
          {bootstrapStatus?.status === 'running' ? 'Ingesting...' : 'Bootstrap Ingestion'}
        </button>
        {bootstrapStatus?.status === 'running' && (
          <div className="mt-2">
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full transition-all"
                style={{ width: `${(bootstrapStatus.processedFiles / Math.max(bootstrapStatus.totalFiles, 1)) * 100}%` }}
              />
            </div>
            <span className="text-[10px] text-gray-500">
              {bootstrapStatus.processedFiles}/{bootstrapStatus.totalFiles} files
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add to settings page**

In `src/app/(desktop)/settings/page.tsx`, import and conditionally render:

```typescript
import { CortexSettings } from '@/components/cortex/cortex-settings';
// ... inside the settings page component, after existing sections:
{hasCortex && <CortexSettings />}
```

The `hasCortex` flag comes from `useTier()` which is already available in the settings page.

- [ ] **Step 3: Commit**

```bash
git add src/components/cortex/cortex-settings.tsx src/app/(desktop)/settings/page.tsx
git commit -m "feat(cortex): add Cortex settings section to settings page"
```

---

### Task 23: Injection Badge (Pane Header)

**Files:**
- Create: `src/components/cortex/injection-badge.tsx`
- Modify: `src/components/terminal/terminal-pane.tsx`

- [ ] **Step 1: Create injection badge**

Create `src/components/cortex/injection-badge.tsx`:

```typescript
'use client';

import { useState } from 'react';

interface InjectionBadgeProps {
  /** Number of knowledge units injected into the last prompt */
  count: number;
  /** Details of what was injected (shown on click) */
  items?: Array<{ type: string; text: string }>;
}

export function InjectionBadge({ count, items }: InjectionBadgeProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (count === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-purple-400 hover:bg-purple-500/10 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
        {count} item{count !== 1 ? 's' : ''}
      </button>

      {showDetails && items && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-gray-900 border border-white/10 rounded-lg shadow-xl z-50 p-2 space-y-1">
          {items.map((item, i) => (
            <div key={i} className="text-[10px] text-gray-400">
              <span className="text-purple-400">[{item.type}]</span> {item.text.slice(0, 100)}
              {item.text.length > 100 && '...'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

The badge reads injection data from a shared state. The injection count is set by the Cortex hook injection system when it augments a prompt. For v1, this is plumbed through a simple event emitter or React context that the terminal pane subscribes to.

- [ ] **Step 2: Add to terminal pane header**

In `src/components/terminal/terminal-pane.tsx`, import `InjectionBadge` and `useTier`. Add the badge to the pane header area, gated with `hasCortex`:

```typescript
import { InjectionBadge } from '@/components/cortex/injection-badge';
// In the pane header JSX, alongside existing badges:
{hasCortex && <InjectionBadge count={injectionCount} items={injectionItems} />}
```

The `injectionCount` and `injectionItems` come from a Cortex injection state hook (can be a simple `useState` initially, wired later).

- [ ] **Step 3: Commit**

```bash
git add src/components/cortex/injection-badge.tsx src/components/terminal/terminal-pane.tsx
git commit -m "feat(cortex): add injection badge to terminal pane headers"
```

---

## Chunk 7: Import/Export (Portability)

### Task 24: .cortexpack Exporter

**Files:**
- Create: `src/lib/cortex/portability/exporter.ts`
- Create: `src/app/api/cortex/export/route.ts`
- Create: `tests/lib/cortex/portability/exporter.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/portability/exporter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createManifest, serializeKnowledgeToJSONL } from '@/lib/cortex/portability/exporter';

describe('exporter', () => {
  it('creates a valid manifest', () => {
    const manifest = createManifest({
      scope: 'full',
      unitCount: 42,
      includeEmbeddings: false,
    });
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.unitCount).toBe(42);
    expect(manifest.includeEmbeddings).toBe(false);
    expect(manifest.exportDate).toBeDefined();
  });

  it('serializes knowledge units to JSONL', () => {
    const units = [
      { id: '1', text: 'Use JWT', type: 'decision', confidence: 0.9 },
      { id: '2', text: 'No ORMs', type: 'preference', confidence: 0.95 },
    ];
    const jsonl = serializeKnowledgeToJSONL(units as any);
    const lines = jsonl.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('1');
    expect(JSON.parse(lines[1]).id).toBe('2');
  });
});
```

- [ ] **Step 2: Implement exporter**

Create `src/lib/cortex/portability/exporter.ts`:

```typescript
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { Writable } from 'stream';
import path from 'path';
import fs from 'fs';
import tar from 'tar'; // Uses Node.js built-in tar via `node:` or npm tar package
import type { CortexStore } from '../store';
import type { KnowledgeUnit } from '../knowledge/types';

export interface ExportManifest {
  version: string;
  exportDate: string;
  scope: string;
  unitCount: number;
  includeEmbeddings: boolean;
  sourceNode?: string;
}

export function createManifest(opts: {
  scope: string;
  unitCount: number;
  includeEmbeddings: boolean;
  sourceNode?: string;
}): ExportManifest {
  return {
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    scope: opts.scope,
    unitCount: opts.unitCount,
    includeEmbeddings: opts.includeEmbeddings,
    sourceNode: opts.sourceNode,
  };
}

/** Serialize knowledge units to JSONL (one JSON object per line). */
export function serializeKnowledgeToJSONL(units: KnowledgeUnit[]): string {
  return units.map(u => {
    // Strip vectors from JSONL if embeddings are separate
    const { vector, ...rest } = u;
    return JSON.stringify(rest);
  }).join('\n') + '\n';
}

/**
 * Export a .cortexpack archive (tar.gz) to the specified output path.
 */
export async function exportCortexpack(
  store: CortexStore,
  outputPath: string,
  opts: {
    scope: 'full' | 'workspace' | 'personal';
    workspaceId?: number;
    includeEmbeddings?: boolean;
  },
): Promise<{ path: string; unitCount: number }> {
  const tmpDir = `${outputPath}.tmp`;
  fs.mkdirSync(tmpDir, { recursive: true });

  // Collect units from relevant layers
  const layers = opts.scope === 'personal'
    ? ['personal']
    : opts.scope === 'workspace' && opts.workspaceId
      ? [`workspace/${opts.workspaceId}`]
      : ['personal', 'workspace', 'team'];

  const allUnits: KnowledgeUnit[] = [];
  for (const layer of layers) {
    // Search with a zero vector to get all units (sorted by distance, but we want all)
    // LanceDB doesn't have a "get all" — use a large limit
    const dummyVector = new Array(store['dimensions'] || 384).fill(0);
    const units = await store.search(layer, dummyVector, 10000);
    allUnits.push(...units);
  }

  // Write manifest
  const manifest = createManifest({
    scope: opts.scope,
    unitCount: allUnits.length,
    includeEmbeddings: opts.includeEmbeddings ?? false,
  });
  fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Write knowledge.jsonl
  fs.writeFileSync(path.join(tmpDir, 'knowledge.jsonl'), serializeKnowledgeToJSONL(allUnits));

  // Create tar.gz
  await tar.create(
    { gzip: true, file: outputPath, cwd: tmpDir },
    ['manifest.json', 'knowledge.jsonl'],
  );

  // Clean up tmp
  fs.rmSync(tmpDir, { recursive: true, force: true });

  return { path: outputPath, unitCount: allUnits.length };
}
```

- [ ] **Step 3: Create export API route**

Create `src/app/api/cortex/export/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { exportCortexpack } from '@/lib/cortex/portability/exporter';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const outputPath = path.join(os.tmpdir(), `cortex-export-${Date.now()}.cortexpack`);

    const result = await exportCortexpack(cortex.store, outputPath, {
      scope: body.scope || 'full',
      workspaceId: body.workspace_id,
      includeEmbeddings: body.include_embeddings ?? false,
    });

    // Stream the file back
    const fileBuffer = fs.readFileSync(result.path);
    fs.unlinkSync(result.path); // Clean up

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="cortex-export.cortexpack"`,
      },
    });
  });
}
```

- [ ] **Step 4: Run test, commit**

```bash
npx vitest run tests/lib/cortex/portability/exporter.test.ts
git add src/lib/cortex/portability/exporter.ts src/app/api/cortex/export/ tests/lib/cortex/portability/
git commit -m "feat(cortex): add .cortexpack exporter with manifest and knowledge JSONL"
```

---

### Task 25: .cortexpack Importer

**Files:**
- Create: `src/lib/cortex/portability/importer.ts`
- Create: `src/app/api/cortex/import/route.ts`
- Create: `src/app/api/cortex/import/status/route.ts`
- Create: `tests/lib/cortex/portability/importer.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/lib/cortex/portability/importer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseKnowledgeJSONL, applyMergeStrategy } from '@/lib/cortex/portability/importer';

describe('importer', () => {
  it('parses JSONL into knowledge units', () => {
    const jsonl = '{"id":"1","text":"Use JWT","type":"decision"}\n{"id":"2","text":"No ORMs","type":"preference"}\n';
    const units = parseKnowledgeJSONL(jsonl);
    expect(units).toHaveLength(2);
    expect(units[0].text).toBe('Use JWT');
  });

  it('skips malformed lines', () => {
    const jsonl = '{"id":"1","text":"ok"}\nnot json\n{"id":"2","text":"also ok"}\n';
    const units = parseKnowledgeJSONL(jsonl);
    expect(units).toHaveLength(2);
  });

  it('append strategy returns all units', () => {
    const incoming = [{ id: '1', text: 'new' }] as any[];
    const existing = [{ id: '2', text: 'old' }] as any[];
    const result = applyMergeStrategy('append', incoming, existing);
    expect(result).toHaveLength(1); // Only incoming units to add
  });

  it('replace strategy returns only incoming', () => {
    const incoming = [{ id: '1', text: 'new' }] as any[];
    const existing = [{ id: '2', text: 'old' }] as any[];
    const result = applyMergeStrategy('replace', incoming, existing);
    expect(result).toHaveLength(1);
  });

  it('merge strategy deduplicates by text similarity', () => {
    const incoming = [
      { id: '1', text: 'Use JWT for auth', confidence: 0.9 },
      { id: '2', text: 'totally unique knowledge', confidence: 0.8 },
    ] as any[];
    const existing = [
      { id: '3', text: 'Use JWT for auth', confidence: 0.85 },
    ] as any[];
    const result = applyMergeStrategy('merge', incoming, existing);
    // 'Use JWT for auth' should be deduped (exact match), only 'totally unique' added
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('totally unique knowledge');
  });
});
```

- [ ] **Step 2: Implement importer**

Create `src/lib/cortex/portability/importer.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import tar from 'tar';
import type { CortexStore } from '../store';
import type { EmbeddingProvider } from '../embeddings';
import type { KnowledgeUnit } from '../knowledge/types';

export type MergeStrategy = 'append' | 'merge' | 'replace';

/** Parse JSONL string into knowledge unit objects. */
export function parseKnowledgeJSONL(jsonl: string): any[] {
  const units: any[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      units.push(JSON.parse(line));
    } catch { /* skip malformed */ }
  }
  return units;
}

/**
 * Apply merge strategy to determine which incoming units to add.
 * - append: add all incoming units
 * - merge: skip incoming units that match existing units by text (exact match)
 * - replace: add all incoming (caller should clear existing first)
 */
export function applyMergeStrategy(
  strategy: MergeStrategy,
  incoming: any[],
  existing: any[],
): any[] {
  if (strategy === 'append' || strategy === 'replace') {
    return incoming;
  }

  // merge: deduplicate by exact text match
  const existingTexts = new Set(existing.map(u => u.text));
  return incoming.filter(u => !existingTexts.has(u.text));
}

export interface ImportProgress {
  status: 'idle' | 'running' | 'complete' | 'error';
  totalUnits: number;
  importedUnits: number;
  errors: string[];
}

let _importProgress: ImportProgress = {
  status: 'idle', totalUnits: 0, importedUnits: 0, errors: [],
};

export function getImportProgress(): ImportProgress {
  return { ..._importProgress };
}

/**
 * Import a .cortexpack archive.
 */
export async function importCortexpack(
  archivePath: string,
  store: CortexStore,
  embedding: EmbeddingProvider,
  opts: {
    targetLayer: string;
    mergeStrategy: MergeStrategy;
    reEmbed?: boolean;
  },
): Promise<ImportProgress> {
  _importProgress = { status: 'running', totalUnits: 0, importedUnits: 0, errors: [] };

  const tmpDir = `${archivePath}.extract`;
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    // Extract archive
    await tar.extract({ file: archivePath, cwd: tmpDir });

    // Read knowledge
    const jsonlPath = path.join(tmpDir, 'knowledge.jsonl');
    if (!fs.existsSync(jsonlPath)) {
      throw new Error('knowledge.jsonl not found in archive');
    }

    const incoming = parseKnowledgeJSONL(fs.readFileSync(jsonlPath, 'utf-8'));
    _importProgress.totalUnits = incoming.length;

    // Get existing units for merge comparison
    let existing: any[] = [];
    if (opts.mergeStrategy === 'merge') {
      const dummyVector = new Array(embedding.dimensions).fill(0);
      existing = await store.search(opts.targetLayer, dummyVector, 10000);
    }

    // Apply merge strategy
    const toImport = applyMergeStrategy(opts.mergeStrategy, incoming, existing);

    // Re-embed if needed (no vectors in JSONL)
    for (const unit of toImport) {
      try {
        if (opts.reEmbed || !unit.vector) {
          const [vector] = await embedding.embed([unit.text]);
          unit.vector = vector;
        }
        unit.layer = opts.targetLayer.includes('/') ? 'workspace' : opts.targetLayer;
        await store.add(opts.targetLayer, unit);
        _importProgress.importedUnits++;
      } catch (err) {
        _importProgress.errors.push(`Failed to import unit ${unit.id}: ${err}`);
      }
    }

    _importProgress.status = _importProgress.errors.length > 0 ? 'error' : 'complete';
  } catch (err) {
    _importProgress.status = 'error';
    _importProgress.errors.push(`Import failed: ${err}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { ..._importProgress };
}
```

- [ ] **Step 3: Create import API routes**

Create `src/app/api/cortex/import/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { importCortexpack } from '@/lib/cortex/portability/importer';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    // Handle multipart upload
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const tmpPath = path.join(os.tmpdir(), `cortex-import-${Date.now()}.cortexpack`);
    const bytes = await file.arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(bytes));

    const targetLayer = (formData.get('target_layer') as string) || 'workspace';
    const mergeStrategy = (formData.get('merge_strategy') as string) || 'merge';

    // Run import async
    importCortexpack(tmpPath, cortex.store, cortex.embedding, {
      targetLayer,
      mergeStrategy: mergeStrategy as any,
      reEmbed: true,
    }).finally(() => {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    });

    return NextResponse.json({ status: 'started' });
  });
}
```

Create `src/app/api/cortex/import/status/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable } from '@/lib/cortex';
import { getImportProgress } from '@/lib/cortex/portability/importer';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    return NextResponse.json(getImportProgress());
  });
}
```

- [ ] **Step 4: Run test, commit**

```bash
npx vitest run tests/lib/cortex/portability/importer.test.ts
git add src/lib/cortex/portability/importer.ts src/app/api/cortex/import/ tests/lib/cortex/portability/importer.test.ts
git commit -m "feat(cortex): add .cortexpack importer with merge strategies"
```

---

## Chunk 8: Federation

### Task 26: Federation Search (Query Delegation)

**Files:**
- Create: `src/lib/cortex/retrieval/federation.ts`
- Create: `src/app/api/cortex/federation/search/route.ts`

The existing network proxy at `/api/network/proxy/[nodeId]/[...path]` forwards arbitrary API requests to connected nodes. Cortex federation uses this to send search queries. Verify this proxy exists before implementing — if the route doesn't exist, create it following the pattern in `src/app/api/network/`.

- [ ] **Step 1: Implement federation query**

Create `src/lib/cortex/retrieval/federation.ts`:

```typescript
import type { ScoredKnowledge } from '../knowledge/types';
import { api } from '@/lib/api';

interface FederationQueryOpts {
  query: string;
  queryVector: number[];
  connectedNodes: Array<{ id: string; url: string }>;
  timeoutMs?: number;
  limit?: number;
}

/**
 * Query connected federation nodes for knowledge.
 * Sends parallel requests to all nodes, merges results by score.
 * Respects timeout — if a node is slow, skip its results.
 */
export async function federationSearch(
  opts: FederationQueryOpts,
): Promise<ScoredKnowledge[]> {
  const { connectedNodes, queryVector, timeoutMs = 500, limit = 5 } = opts;

  const promises = connectedNodes.map(async (node) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(
        api(`/api/network/proxy/${node.id}/api/cortex/federation/search?q=${encodeURIComponent(opts.query)}&limit=${limit}`),
        { signal: controller.signal },
      );
      if (!res.ok) return [];
      const data = await res.json();
      // Tag results with source node
      return (data.results || []).map((r: any) => ({
        ...r,
        metadata: { ...r.metadata, source_node: node.id },
      }));
    } catch {
      return []; // Timeout or network error — skip this node
    } finally {
      clearTimeout(timer);
    }
  });

  const remoteResults = (await Promise.all(promises)).flat();

  // Sort by score descending, take top limit
  return remoteResults
    .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
    .slice(0, limit);
}
```

- [ ] **Step 2: Create federation search route**

Create `src/app/api/cortex/federation/search/route.ts`. This is the endpoint that **remote** nodes hit to search this node's Cortex. It enforces Federation tier and never returns personal-layer results:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { IS_FEDERATION } from '@/lib/tier';
import { getCortex } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!IS_FEDERATION) {
      return NextResponse.json({ error: 'Federation required' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ results: [] });

    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '5', 10);

    if (!query) return NextResponse.json({ results: [] });

    const [queryVector] = await cortex.embedding.embed([query]);

    // Only search team and collaborative workspace layers — never personal
    const results = await cortex.search.search(queryVector, {
      workspaceId: null,
      limit,
      excludeLayers: ['personal'], // Privacy: never expose personal to remote
    });

    return NextResponse.json({ results });
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/cortex/retrieval/federation.ts src/app/api/cortex/federation/search/
git commit -m "feat(cortex): add federation query delegation and remote search endpoint"
```

---

### Task 27: Active Knowledge Propagation

**Files:**
- Create: `src/app/api/cortex/federation/teach/route.ts`
- Create: `src/app/api/cortex/federation/pending/route.ts`
- Create: `src/app/api/cortex/federation/resolve/route.ts`

- [ ] **Step 1: Create teach endpoint**

Create `src/app/api/cortex/federation/teach/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { IS_FEDERATION } from '@/lib/tier';
import { getCortex } from '@/lib/cortex';
import { cosineSimilarity, detectContradictions } from '@/lib/cortex/knowledge/contradiction';

const CONFIDENCE_DECAY_PER_HOP = 0.8;
const MAX_HOPS = 3;
const DEDUP_THRESHOLD = 0.95;

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!IS_FEDERATION) {
      return NextResponse.json({ error: 'Federation required' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const { knowledge, provenance } = body;

    if (!knowledge?.text || !provenance) {
      return NextResponse.json({ error: 'knowledge and provenance required' }, { status: 400 });
    }

    // Check max hops
    if (provenance.hops && provenance.hops.length >= MAX_HOPS) {
      return NextResponse.json({ status: 'rejected', reason: 'max_hops_exceeded' });
    }

    // Embed the incoming knowledge
    const [vector] = await cortex.embedding.embed([knowledge.text]);

    // Dedup check — search team layer for similar
    const existing = await cortex.store.search('team', vector, 5);
    const isDuplicate = existing.some(
      e => cosineSimilarity(vector, e.vector) > DEDUP_THRESHOLD
    );
    if (isDuplicate) {
      return NextResponse.json({ status: 'skipped', reason: 'duplicate' });
    }

    // Confidence adjustment: multiply by decay per hop
    const hopCount = (provenance.hops?.length || 0) + 1;
    const adjustedConfidence = knowledge.confidence * Math.pow(CONFIDENCE_DECAY_PER_HOP, hopCount);

    // Contradiction check
    const contradictions = detectContradictions(
      { ...knowledge, vector, id: 'incoming' },
      existing,
      0.85,
    );

    if (contradictions.length > 0) {
      // Store as pending contradiction for user review
      await cortex.store.add('team', {
        ...knowledge,
        id: crypto.randomUUID(),
        vector,
        layer: 'team',
        confidence: adjustedConfidence,
        metadata: {
          ...knowledge.metadata,
          provenance,
          status: 'pending_review',
          contradicts: contradictions.map(c => c.existingId),
        },
      });
      return NextResponse.json({ status: 'pending_review', contradictions: contradictions.length });
    }

    // No contradiction — store directly
    await cortex.store.add('team', {
      ...knowledge,
      id: crypto.randomUUID(),
      vector,
      layer: 'team',
      confidence: adjustedConfidence,
      metadata: { ...knowledge.metadata, provenance, source: 'federation_teach' },
    });

    return NextResponse.json({ status: 'accepted' });
  });
}
```

- [ ] **Step 2: Create pending endpoint**

Create `src/app/api/cortex/federation/pending/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { IS_FEDERATION } from '@/lib/tier';
import { getCortex } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!IS_FEDERATION) {
      return NextResponse.json({ error: 'Federation required' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ units: [] });

    // Search team layer for units with pending_review status
    const dummyVector = new Array(cortex.embedding.dimensions).fill(0);
    const allTeam = await cortex.store.search('team', dummyVector, 100);
    const pending = allTeam.filter(
      u => u.metadata?.status === 'pending_review'
    );

    return NextResponse.json({ units: pending, count: pending.length });
  });
}
```

- [ ] **Step 3: Create resolve endpoint**

Create `src/app/api/cortex/federation/resolve/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { IS_FEDERATION } from '@/lib/tier';
import { getCortex } from '@/lib/cortex';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!IS_FEDERATION) {
      return NextResponse.json({ error: 'Federation required' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { id, action } = await request.json();
    // action: 'accept' | 'reject' | 'context-dependent'

    if (!id || !action) {
      return NextResponse.json({ error: 'id and action required' }, { status: 400 });
    }

    if (action === 'accept') {
      // Promote: remove pending_review status, boost confidence
      const safeId = id.replace(/'/g, "''");
      const results = await cortex.store.search('team', [], 1, `id = '${safeId}'`);
      if (results.length > 0) {
        const unit = results[0];
        await cortex.store.delete('team', id);
        unit.metadata = { ...unit.metadata, status: 'accepted' };
        unit.confidence = Math.min(unit.confidence * 1.1, 0.95); // Slight boost
        await cortex.store.add('team', unit);
      }
    } else if (action === 'reject') {
      // Downrank or delete
      await cortex.store.delete('team', id);
    } else if (action === 'context-dependent') {
      // Keep both — just clear the pending status
      const safeId = id.replace(/'/g, "''");
      const results = await cortex.store.search('team', [], 1, `id = '${safeId}'`);
      if (results.length > 0) {
        const unit = results[0];
        await cortex.store.delete('team', id);
        unit.metadata = { ...unit.metadata, status: 'context_dependent' };
        await cortex.store.add('team', unit);
      }
    }

    return NextResponse.json({ success: true, action });
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cortex/federation/teach/ src/app/api/cortex/federation/pending/ src/app/api/cortex/federation/resolve/
git commit -m "feat(cortex): add active knowledge propagation endpoints"
```

---

### Task 28: Federation Sync Modes

**Files:**
- Create: `src/lib/cortex/retrieval/sync.ts` — Background sync polling logic
- Modify: `src/lib/cortex/index.ts` — Start sync timer in Cortex singleton init

Background sync polls connected nodes at a configurable interval. Real-time sync uses the existing WebSocket infrastructure in `src/lib/ws/` (Spaces already has a WS server for terminal and collaboration). The sync timer is started when the Cortex singleton initializes and stopped on shutdown.

**Note:** Next.js App Router does not natively support WebSocket routes. The real-time sync WebSocket should be added to the existing custom WebSocket server (the same one that handles terminal PTY connections), not as an App Router route. Create the handler in `src/lib/cortex/retrieval/sync.ts` and register it in the WS server setup.

- [ ] **Step 1: Implement background sync**

Create `src/lib/cortex/retrieval/sync.ts`:

```typescript
import type { CortexStore } from '../store';
import type { EmbeddingProvider } from '../embeddings';
import { federationSearch } from './federation';

export interface SyncOptions {
  intervalMs: number;
  connectedNodes: Array<{ id: string; url: string }>;
  timeoutMs: number;
}

/**
 * Background sync: polls connected nodes at an interval,
 * pulls new team-layer knowledge, and merges locally.
 */
export class FederationSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private store: CortexStore,
    private embedding: EmbeddingProvider,
    private options: SyncOptions,
  ) {}

  /** Start the polling loop. Called from Cortex singleton init. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sync(), this.options.intervalMs);
    // Run once immediately
    this.sync();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sync(): Promise<void> {
    if (this.running || this.options.connectedNodes.length === 0) return;
    this.running = true;

    try {
      // Query all nodes for recent team-layer knowledge
      const results = await federationSearch({
        query: '*', // Broad query for sync
        queryVector: new Array(this.embedding.dimensions).fill(0),
        connectedNodes: this.options.connectedNodes,
        timeoutMs: this.options.timeoutMs,
        limit: 50,
      });

      // Store in local team layer (dedup handled by store)
      for (const unit of results) {
        try {
          if (!unit.vector) {
            const [vec] = await this.embedding.embed([unit.text]);
            unit.vector = vec;
          }
          unit.layer = 'team';
          await this.store.add('team', unit);
        } catch { /* skip individual failures */ }
      }
    } catch (err) {
      console.error('[Cortex] Background sync error:', err);
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 2: Wire sync into Cortex singleton**

In `src/lib/cortex/index.ts`, after initializing the store/search/pipeline, check if the sync mode is `background-sync` and start the `FederationSync` timer. Add a `shutdown()` function that stops the timer.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cortex/retrieval/sync.ts src/lib/cortex/index.ts
git commit -m "feat(cortex): add background federation sync with polling"
```

---

## Chunk 9: Workspace Context and Timeline Routes

### Task 29: Remaining API Routes

**Files:**
- Create: `src/app/api/cortex/workspace/[id]/context/route.ts`
- Create: `src/app/api/cortex/timeline/route.ts`

- [ ] **Step 1: Create workspace context route**

Create `src/app/api/cortex/workspace/[id]/context/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { id } = await params;
    const workspaceId = parseInt(id, 10);
    const url = new URL(request.url);
    const depth = url.searchParams.get('depth') || 'brief'; // 'brief' or 'full'
    const limit = depth === 'brief' ? 10 : 50;

    // Get all knowledge for this workspace, sorted by confidence
    const dummyVector = new Array(cortex.embedding.dimensions).fill(0);
    const results = await cortex.store.search(
      `workspace/${workspaceId}`,
      dummyVector,
      limit,
    );

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);

    return NextResponse.json({
      workspace_id: workspaceId,
      depth,
      units: results,
      count: results.length,
    });
  });
}
```

- [ ] **Step 2: Create timeline route**

Create `src/app/api/cortex/timeline/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');
    const projectPath = url.searchParams.get('project_path');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    // Timeline: decisions and patterns sorted chronologically
    const layerKey = workspaceId ? `workspace/${workspaceId}` : 'personal';
    const dummyVector = new Array(cortex.embedding.dimensions).fill(0);
    let results = await cortex.store.search(layerKey, dummyVector, limit * 2);

    // Filter to timeline-relevant types
    results = results.filter(r =>
      ['decision', 'pattern', 'error_fix', 'summary'].includes(r.type)
    );

    // Filter by project path if specified
    if (projectPath) {
      results = results.filter(r => r.project_path === projectPath);
    }

    // Sort chronologically (newest first)
    results.sort((a, b) =>
      new Date(b.source_timestamp).getTime() - new Date(a.source_timestamp).getTime()
    );

    return NextResponse.json({
      timeline: results.slice(0, limit),
      count: results.length,
    });
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cortex/workspace/ src/app/api/cortex/timeline/
git commit -m "feat(cortex): add workspace context and timeline API routes"
```

---

## Chunk 10: Integration and Wiring

### Task 30: Wire MCP Server to Cortex Singleton

**Files:**
- Modify: `src/lib/cortex/mcp/server.ts`

- [ ] **Step 1: Verify existing wiring**

The 4 core tools (cortex_search, cortex_teach, cortex_forget, cortex_status) were already wired in Task 13's `handleToolCall`. Verify they work by running the MCP server test.

- [ ] **Step 2: Add query MCP tools**

Add `cortex_recall` (retrieve by ID or exact match) and `cortex_similar` (find analogous experiences by input text). Define tool schemas with appropriate inputSchema, add cases to `handleToolCall`.

- [ ] **Step 3: Add context and timeline MCP tools**

Add `cortex_context` (full workspace context, params: `workspace_id`, `depth: 'brief' | 'full'`) and `cortex_timeline` (chronological history, params: `workspace_id`, `project_path`, `limit`). Wire to the `/api/cortex/workspace/[id]/context` and `/api/cortex/timeline` endpoints internally.

- [ ] **Step 4: Add portability MCP tools**

Add `cortex_export` (params: `scope`, `workspace_id`, `include_embeddings`, `format`) and `cortex_import` (params: `path`, `target_layer`, `merge_strategy`, `re_embed`). Wire to the exporter/importer modules.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(cortex): wire MCP server to Cortex singleton with all 10 tools"
```

---

### Task 31: Extend SpacesConfig

**Files:**
- Modify: `src/lib/config.ts`

- [ ] **Step 1: Add cortex field to SpacesConfig**

In `src/lib/config.ts`:
- Import `CortexConfig` type from `./cortex/config`
- Add `cortex?: CortexConfig` to the `SpacesConfig` interface
- Update `readConfig()` to preserve the `cortex` key when reading
- Update `writeConfig()` to preserve the `cortex` key when writing

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(cortex): extend SpacesConfig with cortex field"
```

---

### Task 32: Update TierFlags for Client

**Files:**
- Modify: `src/hooks/use-tier.ts` — Add `hasCortex` to `TierFlags` interface
- Modify: `src/components/layout/tier-provider.tsx` — Include `hasCortex` in context value

- [ ] **Step 1: Add hasCortex to tier flags**

In `src/hooks/use-tier.ts`, add `hasCortex: boolean` to the `TierFlags` interface and default it to `false`.
In `src/components/layout/tier-provider.tsx`, set `hasCortex` from the server's `HAS_CORTEX` value (imported from `@/lib/tier`).
In `src/components/layout/providers.tsx`, ensure the tier provider passes this field through.

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(cortex): add hasCortex flag to tier system"
```

---

### Task 33: Final Integration Test

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass, 0 failures. If any Cortex tests fail, fix before proceeding.

- [ ] **Step 2: Run build**

```bash
npx next build
```

Verify no TypeScript errors.

- [ ] **Step 3: Manual smoke test**

1. Start Spaces in Teams tier
2. Verify Cortex indicator appears in sidebar (purple badge with knowledge count)
3. Open Settings → verify Cortex section renders
4. Trigger bootstrap → verify progress
5. Search via API → verify results
6. Teach via API → verify storage

- [ ] **Step 4: Final commit**

```bash
git commit -m "feat(cortex): integration complete — all modules wired"
```
