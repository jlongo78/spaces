# Cortex Wiring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up 5 existing-but-unused Cortex subsystems (dedup, extractors, staleness, distillation, MCP server) and fix 2 bugs.

**Architecture:** Layered wiring in dependency order. Each layer is independently shippable. The pipeline gains dedup + classification before embedding. Search gains staleness scoring. Background distillation extracts structured knowledge via LLM. MCP server exposes Cortex to Claude Code as tools.

**Tech Stack:** TypeScript, Vitest, LanceDB, Node.js `fetch` (for LLM API calls), MCP stdio transport

**Spec:** `docs/superpowers/specs/2026-03-13-cortex-wiring-design.md`

---

## Chunk 1: Deduplication (Layer 1)

### Task 1: Add `textHash` to deduplicator

**Files:**
- Modify: `src/lib/cortex/ingestion/deduplicator.ts`
- Modify: `tests/lib/cortex/ingestion/deduplicator.test.ts`

- [ ] **Step 1: Write failing test for `textHash`**

In `tests/lib/cortex/ingestion/deduplicator.test.ts`, add:

```typescript
import { cosineSimilarity, isDuplicate, textHash } from '@/lib/cortex/ingestion/deduplicator';

describe('textHash', () => {
  it('returns consistent SHA-256 hex for same input', () => {
    const h1 = textHash('hello world');
    const h2 = textHash('hello world');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('normalizes whitespace before hashing', () => {
    const h1 = textHash('hello   world\n\n');
    const h2 = textHash('hello world');
    expect(h1).toBe(h2);
  });

  it('returns different hashes for different text', () => {
    expect(textHash('foo')).not.toBe(textHash('bar'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/ingestion/deduplicator.test.ts`
Expected: FAIL — `textHash` is not exported

- [ ] **Step 3: Implement `textHash`**

In `src/lib/cortex/ingestion/deduplicator.ts`, add at the top:

```typescript
import { createHash } from 'crypto';

export function textHash(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/ingestion/deduplicator.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/ingestion/deduplicator.ts tests/lib/cortex/ingestion/deduplicator.test.ts
git commit -m "feat(cortex): add textHash for dedup hash check"
```

---

### Task 2: Add `updateAccessCount` to store

**Files:**
- Modify: `src/lib/cortex/store.ts`
- Modify: `tests/lib/cortex/store.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/lib/cortex/store.test.ts`, add a test for `updateAccessCount`:

```typescript
it('updates access_count on a unit', async () => {
  // Assumes a unit with known id has been added in a beforeEach or earlier test
  // Add a unit first
  const unit = makeUnit({ id: 'access-test', access_count: 0 });
  await store.add('personal', unit);

  await store.updateAccessCount('personal', 'access-test');

  // Retrieve and check — use browse since we need to find by id
  const results = await store.browse('personal', 100);
  const found = results.find(r => r.id === 'access-test');
  expect(found).toBeDefined();
  expect(found!.access_count).toBe(1);
});
```

Note: adapt to the existing test file's setup patterns (mock store vs real LanceDB). If the test file uses mocks, test the method signature exists and is callable. If it uses real LanceDB, test the actual update.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/store.test.ts`
Expected: FAIL — `updateAccessCount` does not exist

- [ ] **Step 3: Implement `updateAccessCount`**

In `src/lib/cortex/store.ts`, add after the `delete` method (~line 163):

```typescript
async updateAccessCount(layerKey: string, id: string): Promise<void> {
  const conn = await this.getConnection(layerKey);
  const tableNames = await conn.tableNames();
  if (!tableNames.includes(TABLE_NAME)) return;

  const table = await conn.openTable(TABLE_NAME);
  const safeId = id.replace(/'/g, "''");
  // LanceDB doesn't support UPDATE; delete + re-add with bumped count
  // Use query().where() instead of vectorSearch to avoid dimension dependency
  const rows = await table.query()
    .where(`id = '${safeId}'`).limit(1).toArray();
  if (rows.length === 0) return;

  const row = rows[0];
  await table.delete(`id = '${safeId}'`);
  row.access_count = (row.access_count || 0) + 1;
  row.last_accessed = new Date().toISOString();
  await table.add([row]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/store.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/store.ts tests/lib/cortex/store.test.ts
git commit -m "feat(cortex): add updateAccessCount to store"
```

---

### Task 3: Wire dedup into the pipeline

**Files:**
- Modify: `src/lib/cortex/ingestion/pipeline.ts`
- Modify: `tests/lib/cortex/ingestion/pipeline.test.ts`

- [ ] **Step 1: Write failing test — duplicate is skipped**

In `tests/lib/cortex/ingestion/pipeline.test.ts`, first add `updateAccessCount` to the shared `mockStore` in the `beforeEach` block:

```typescript
// In the existing beforeEach, add to mockStore:
mockStore.updateAccessCount = vi.fn().mockResolvedValue(undefined);
```

Then add these tests:

```typescript
it('skips duplicate chunks (hash match)', async () => {
  const msg = { role: 'human', content: 'Add auth', timestamp: new Date().toISOString() };
  const msgs = [msg, { role: 'assistant', content: 'Done.', timestamp: new Date().toISOString() }];
  const ctx = { sessionId: 's1', workspaceId: 1, agentType: 'claude' as const, projectPath: '/p' };

  // Ingest twice with identical content
  await pipeline.ingest(msgs, ctx);
  await pipeline.ingest(msgs, ctx);

  // store.add should only be called once (second ingest is hash-deduped)
  expect(mockStore.add).toHaveBeenCalledTimes(1);
});

it('skips cosine-similar chunks and bumps access count', async () => {
  // store.search returns a near-match with L2 distance below threshold
  mockStore.search.mockResolvedValueOnce([{
    id: 'existing-1', text: 'similar text', _distance: 0.01,
    access_count: 0, confidence: 0.8,
  }]);

  const msgs = [
    { role: 'human', content: 'Slightly different auth', timestamp: new Date().toISOString() },
    { role: 'assistant', content: 'Done.', timestamp: new Date().toISOString() },
  ];
  const ctx = { sessionId: 's2', workspaceId: 1, agentType: 'claude' as const, projectPath: '/p' };

  await pipeline.ingest(msgs, ctx);

  expect(mockStore.updateAccessCount).toHaveBeenCalledWith(expect.any(String), 'existing-1');
  expect(mockStore.add).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/cortex/ingestion/pipeline.test.ts`
Expected: FAIL — pipeline doesn't dedup yet

- [ ] **Step 3: Implement dedup in pipeline**

Modify `src/lib/cortex/ingestion/pipeline.ts`:

```typescript
import crypto from 'crypto';
import type { EmbeddingProvider } from '../embeddings';
import type { CortexStore } from '../store';
import type { KnowledgeUnit, RawChunk } from '../knowledge/types';
import { getConfidenceBase } from '../knowledge/types';
import { chunkMessages, type SessionMessage, type ChunkContext } from './chunker';
import { textHash } from './deduplicator';

export interface IngestionResult {
  chunksCreated: number;
  chunksEmbedded: number;
  chunksSkipped: number;
  errors: string[];
}

const COSINE_DEDUP_THRESHOLD = 0.05; // L2 distance < 0.05 = duplicate

export class IngestionPipeline {
  private hashSet = new Set<string>();

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

    // Tier 2: Dedup, embed, and store
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);

      // Phase 1: Hash dedup — filter out exact duplicates before embedding
      const novel: RawChunk[] = [];
      for (const chunk of batch) {
        const hash = textHash(chunk.text);
        if (this.hashSet.has(hash)) {
          result.chunksSkipped++;
        } else {
          this.hashSet.add(hash);
          novel.push(chunk);
        }
      }

      if (novel.length === 0) continue;

      try {
        const texts = novel.map(c => c.text);
        const vectors = await this.embedding.embed(texts);

        for (let j = 0; j < novel.length; j++) {
          const chunk = novel[j];
          const vector = vectors[j];
          const layerKey = chunk.layer === 'workspace' && chunk.workspace_id
            ? `workspace/${chunk.workspace_id}`
            : chunk.layer;

          // Phase 2: Cosine dedup — check store for near-matches
          try {
            const nearestResults = await this.store.search(layerKey, vector, 1);
            if (nearestResults.length > 0) {
              const nearest = nearestResults[0] as any;
              const distance = nearest._distance ?? 1;
              if (distance < COSINE_DEDUP_THRESHOLD) {
                await this.store.updateAccessCount(layerKey, nearest.id);
                result.chunksSkipped++;
                continue;
              }
            }
          } catch {
            // Store may be empty or table not created yet — proceed with add
          }

          const unit: KnowledgeUnit = {
            id: crypto.randomUUID(),
            vector,
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
        result.chunksSkipped += novel.length;
      }
    }

    return result;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/ingestion/pipeline.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full cortex test suite**

Run: `npx vitest run tests/lib/cortex/`
Expected: ALL PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/lib/cortex/ingestion/pipeline.ts tests/lib/cortex/ingestion/pipeline.test.ts
git commit -m "feat(cortex): wire dedup into ingestion pipeline (hash + cosine)"
```

---

## Chunk 2: Extractors (Layer 2)

### Task 4: Wire extractors into pipeline

**Files:**
- Modify: `src/lib/cortex/ingestion/pipeline.ts`
- Modify: `tests/lib/cortex/ingestion/pipeline.test.ts`

- [ ] **Step 1: Write failing test — error/fix detection**

In `tests/lib/cortex/ingestion/pipeline.test.ts`, add:

```typescript
it('classifies error/fix chunks via extractors', async () => {
  const msgs = [
    { role: 'human', content: 'I got TypeError: cannot read undefined', timestamp: new Date().toISOString() },
    { role: 'assistant', content: 'Fixed by adding null check before access.', timestamp: new Date().toISOString() },
  ];
  const ctx = { sessionId: 's3', workspaceId: 1, agentType: 'claude' as const, projectPath: '/p' };

  await pipeline.ingest(msgs, ctx);

  const addCall = mockStore.add.mock.calls[0];
  const storedUnit = addCall[1];
  expect(storedUnit.type).toBe('error_fix');
});

it('classifies decision chunks via extractors', async () => {
  const msgs = [
    { role: 'human', content: 'Which framework?', timestamp: new Date().toISOString() },
    { role: 'assistant', content: 'We decided to use Next.js for the frontend because of SSR support.', timestamp: new Date().toISOString() },
  ];
  const ctx = { sessionId: 's4', workspaceId: 1, agentType: 'claude' as const, projectPath: '/p' };

  await pipeline.ingest(msgs, ctx);

  const addCall = mockStore.add.mock.calls[0];
  const storedUnit = addCall[1];
  expect(storedUnit.type).toBe('decision');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/cortex/ingestion/pipeline.test.ts`
Expected: FAIL — chunks still typed as `conversation`

- [ ] **Step 3: Add extraction step to pipeline**

In `src/lib/cortex/ingestion/pipeline.ts`, add import at the top:

```typescript
import { detectErrorFixPairs, extractDecisionPatterns, extractCommands } from './extractors';
```

Add a private method to classify chunks. Call it after `chunkMessages()` but before the Tier 2 loop:

```typescript
/** Enrich chunk types using regex extractors. Mutates chunks in place. */
private classifyChunks(chunks: RawChunk[]): void {
  for (const chunk of chunks) {
    const errorFixes = detectErrorFixPairs(chunk.text);
    const decisions = extractDecisionPatterns(chunk.text);
    const commands = extractCommands(chunk.text);

    // Priority: decision > error_fix > conversation (default)
    if (decisions.length > 0) {
      chunk.type = 'decision';
      chunk.metadata.decisions = decisions;
    } else if (errorFixes.length > 0) {
      chunk.type = 'error_fix';
      chunk.metadata.error_fixes = errorFixes;
    }

    if (commands.length > 0) {
      chunk.metadata.commands = commands;
    }
  }
}
```

In the `ingest` method, call it after chunking (after `result.chunksCreated = chunks.length;`):

```typescript
    // Tier 1.5: Classify chunks via regex extractors
    this.classifyChunks(chunks);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/ingestion/pipeline.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full cortex test suite**

Run: `npx vitest run tests/lib/cortex/`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/cortex/ingestion/pipeline.ts tests/lib/cortex/ingestion/pipeline.test.ts
git commit -m "feat(cortex): wire extractors into pipeline for chunk classification"
```

---

## Chunk 3: Staleness (Layer 3)

### Task 5: Add staleness scoring to search

**Files:**
- Modify: `src/lib/cortex/retrieval/search.ts`
- Modify: `tests/lib/cortex/retrieval/search.test.ts`

- [ ] **Step 1: Write failing test**

In `tests/lib/cortex/retrieval/search.test.ts`, add a test that verifies stale results score lower than fresh results. The test should mock two results: one with file refs pointing to a recently modified file, one without. Check that the stale one ranks lower.

```typescript
it('reduces score for stale results (modified file refs)', async () => {
  // Mock store.search returning two results
  // Result A: has file_refs ['src/auth.ts'], source_timestamp = 30 days ago
  // Result B: no file_refs, same similarity
  // After staleness, A should rank lower than B

  // Provide a fileStatFn that returns a recent mtime for src/auth.ts
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();

  // Note: store.search() returns deserialized data (file_refs as array, metadata as object)
  mockStore.search.mockResolvedValue([
    { id: 'a', text: 'auth', file_refs: ['src/auth.ts'], source_timestamp: thirtyDaysAgo, confidence: 0.8, stale_score: 0, created: thirtyDaysAgo, _distance: 0.1, access_count: 0, last_accessed: null, metadata: {}, type: 'decision', layer: 'personal', workspace_id: null, session_id: null, agent_type: 'claude', project_path: '/project' },
    { id: 'b', text: 'other', file_refs: [], source_timestamp: thirtyDaysAgo, confidence: 0.8, stale_score: 0, created: thirtyDaysAgo, _distance: 0.1, access_count: 0, last_accessed: null, metadata: {}, type: 'decision', layer: 'personal', workspace_id: null, session_id: null, agent_type: 'claude', project_path: '/project' },
  ]);

  const search = new CortexSearch(mockStore, {
    fileStat: async (filepath: string) => {
      if (filepath.includes('auth.ts')) return { mtime: new Date(yesterday) };
      return null;
    },
  });

  const results = await search.search([0.1, 0.2, 0.3], { limit: 2 });
  // Result B should rank higher (not stale)
  expect(results[0].id).toBe('b');
  expect(results[1].id).toBe('a');
  expect(results[1].stale_score).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/retrieval/search.test.ts`
Expected: FAIL — `CortexSearch` doesn't accept `fileStat` option

- [ ] **Step 3: Add staleness computation to search**

Modify `src/lib/cortex/retrieval/search.ts`:

```typescript
import { computeFileStaleScore } from '../knowledge/staleness';
import fs from 'fs';
import path from 'path';

export interface SearchDeps {
  /** Optional fs.stat wrapper — injectable for testing. */
  fileStat?: (filepath: string) => Promise<{ mtime: Date } | null>;
}

export class CortexSearch {
  private fileStat: (filepath: string) => Promise<{ mtime: Date } | null>;

  constructor(private store: CortexStore, deps: SearchDeps = {}) {
    this.fileStat = deps.fileStat ?? defaultFileStat;
  }
```

Add a helper and update the search loop to compute staleness on the top results:

```typescript
  private async computeStaleness(
    unit: KnowledgeUnit,
    statFn?: (fp: string) => Promise<{ mtime: Date } | null>,
  ): Promise<number> {
    if (unit.file_refs.length === 0) return 0;
    const doStat = statFn ?? this.fileStat;

    const fileModTimes: Record<string, string> = {};
    for (const ref of unit.file_refs) {
      const fullPath = unit.project_path ? path.join(unit.project_path, ref) : ref;
      try {
        const stat = await doStat(fullPath);
        if (stat) fileModTimes[ref] = stat.mtime.toISOString();
      } catch { /* file doesn't exist or not accessible */ }
    }

    return computeFileStaleScore({
      fileRefs: unit.file_refs,
      sourceTimestamp: unit.source_timestamp,
      fileModTimes,
    });
  }
```

In the search method, after collecting `allResults` and before the final sort, compute staleness on the top candidates:

```typescript
    // Compute staleness on top candidates (cache stat calls per search request)
    const candidates = allResults
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit * 2);

    const statCache = new Map<string, { mtime: Date } | null>();
    const cachedFileStat = async (fp: string) => {
      if (!statCache.has(fp)) statCache.set(fp, await this.fileStat(fp));
      return statCache.get(fp)!;
    };

    for (const result of candidates) {
      const staleScore = await this.computeStaleness(result, cachedFileStat);
      if (staleScore > 0) {
        result.stale_score = staleScore;
        // Recompute relevance with staleness
        result.relevance_score = computeRelevanceScore({
          similarity: result.similarity,
          confidence: result.confidence,
          stale_score: staleScore,
          created: result.created,
        }) * (LAYER_WEIGHTS[result.layer] ?? 0.5);
      }
    }

    candidates.sort((a, b) => b.relevance_score - a.relevance_score);
    return candidates.slice(0, limit);
```

Add the default `fileStat`:

```typescript
async function defaultFileStat(filepath: string): Promise<{ mtime: Date } | null> {
  try {
    const stat = await fs.promises.stat(filepath);
    return { mtime: stat.mtime };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Update CortexSearch instantiation in `index.ts`**

In `src/lib/cortex/index.ts` (line 43), no change needed — the `SearchDeps` param is optional and defaults to real `fs.stat`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/retrieval/search.test.ts`
Expected: ALL PASS

Note: existing tests create `CortexSearch(store)` without deps — that's fine since deps is optional.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cortex/retrieval/search.ts tests/lib/cortex/retrieval/search.test.ts
git commit -m "feat(cortex): wire staleness scoring into search"
```

---

### Task 6: Add staleness badge to knowledge card

**Files:**
- Modify: `src/components/cortex/knowledge-card.tsx`

- [ ] **Step 1: Add staleness indicator**

In `src/components/cortex/knowledge-card.tsx`, update the `KnowledgeCardProps` interface to include `stale_score`:

```typescript
interface KnowledgeCardProps {
  unit: {
    id: string;
    text: string;
    type: string;
    confidence: number;
    created: string;
    session_id?: string | null;
    layer: string;
    stale_score?: number;
  };
  onDelete?: (id: string) => void;
}
```

Add the amber badge after the type badge (inside the flex row at line 43-46):

```tsx
{(unit.stale_score ?? 0) > 0.3 && (
  <span
    className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/20 text-amber-400"
    title="Referenced files have changed since this was learned"
  >
    stale
  </span>
)}
```

- [ ] **Step 2: Verify visually** — No automated test. Check by opening Cortex panel in browser if available. Otherwise verify the component compiles:

Run: `npx tsc --noEmit src/components/cortex/knowledge-card.tsx` or just run the full build check.

- [ ] **Step 3: Commit**

```bash
git add src/components/cortex/knowledge-card.tsx
git commit -m "feat(cortex): add staleness badge to knowledge card"
```

---

## Chunk 4: Distillation (Layer 4)

### Task 7: Create `callLLM` implementation

**Files:**
- Create: `src/lib/cortex/distillation/llm.ts`
- Create: `tests/lib/cortex/distillation/llm.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lib/cortex/distillation/llm.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCallLLM, detectLLMProvider } from '@/lib/cortex/distillation/llm';

describe('detectLLMProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('detects anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(detectLLMProvider()).toBe('anthropic');
  });

  it('detects openai when OPENAI_API_KEY is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(detectLLMProvider()).toBe('openai');
  });

  it('returns null when no keys are set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(detectLLMProvider()).toBeNull();
  });
});

describe('createCallLLM', () => {
  it('returns null when no provider available', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(createCallLLM()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/distillation/llm.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement `llm.ts`**

Create `src/lib/cortex/distillation/llm.ts`:

```typescript
type LLMProvider = 'anthropic' | 'openai';

export function detectLLMProvider(): LLMProvider | null {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export function createCallLLM(): ((system: string, user: string) => Promise<string>) | null {
  const provider = detectLLMProvider();
  if (!provider) return null;

  if (provider === 'anthropic') {
    return async (system: string, user: string) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
      const data = await res.json();
      return data.content?.[0]?.text ?? '';
    };
  }

  return async (system: string, user: string) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 2048,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/distillation/llm.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/distillation/llm.ts tests/lib/cortex/distillation/llm.test.ts
git commit -m "feat(cortex): add callLLM with auto-detect for Haiku/GPT-4o-mini"
```

---

### Task 8: Create distillation queue

**Files:**
- Create: `src/lib/cortex/distillation/queue.ts`
- Create: `tests/lib/cortex/distillation/queue.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lib/cortex/distillation/queue.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DistillationQueue } from '@/lib/cortex/distillation/queue';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('DistillationQueue', () => {
  let tmpDir: string;
  let queue: DistillationQueue;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-queue-'));
    queue = new DistillationQueue(tmpDir);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  const entry = { text: 'chunk text 1', layerKey: 'personal', workspaceId: null, agentType: 'claude' };

  it('enqueues and retrieves chunks by id', () => {
    queue.enqueue('id1', entry);
    queue.enqueue('id2', { ...entry, text: 'chunk text 2' });

    const texts = queue.getTexts(['id1', 'id2']);
    expect(texts).toEqual(['chunk text 1', 'chunk text 2']);
  });

  it('getEntries returns full context', () => {
    queue.enqueue('id1', { text: 'ws text', layerKey: 'workspace/5', workspaceId: 5, agentType: 'claude' });
    const entries = queue.getEntries(['id1']);
    expect(entries[0].layerKey).toBe('workspace/5');
    expect(entries[0].workspaceId).toBe(5);
  });

  it('removes processed entries', () => {
    queue.enqueue('id1', entry);
    queue.remove(['id1']);
    expect(queue.getTexts(['id1'])).toEqual([]);
  });

  it('persists to disk and recovers', () => {
    queue.enqueue('id1', entry);

    const queue2 = new DistillationQueue(tmpDir);
    expect(queue2.pendingIds()).toEqual(['id1']);
    expect(queue2.getTexts(['id1'])).toEqual(['chunk text 1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/cortex/distillation/queue.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement queue**

Create `src/lib/cortex/distillation/queue.ts`:

```typescript
import fs from 'fs';
import path from 'path';

const QUEUE_FILE = 'distill-queue.json';

interface QueueEntry {
  text: string;
  layerKey: string;
  workspaceId: number | null;
  agentType: string;
}

/** Simple file-backed queue mapping chunk IDs to their text + context. */
export class DistillationQueue {
  private data: Record<string, QueueEntry> = {};
  private filePath: string;

  constructor(cortexDir: string) {
    this.filePath = path.join(cortexDir, QUEUE_FILE);
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch { this.data = {}; }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data));
  }

  enqueue(id: string, entry: QueueEntry): void {
    this.data[id] = entry;
    this.save();
  }

  getEntries(ids: string[]): QueueEntry[] {
    return ids.map(id => this.data[id]).filter((e): e is QueueEntry => e !== undefined);
  }

  getTexts(ids: string[]): string[] {
    return this.getEntries(ids).map(e => e.text);
  }

  remove(ids: string[]): void {
    for (const id of ids) delete this.data[id];
    this.save();
  }

  pendingIds(): string[] {
    return Object.keys(this.data);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/cortex/distillation/queue.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/distillation/queue.ts tests/lib/cortex/distillation/queue.test.ts
git commit -m "feat(cortex): add file-backed distillation queue"
```

---

### Task 9: Wire distillation into Cortex singleton

**Files:**
- Modify: `src/lib/cortex/index.ts`
- Modify: `src/lib/cortex/ingestion/pipeline.ts`

- [ ] **Step 1: Add distillation wiring to `index.ts`**

In `src/lib/cortex/index.ts`, add imports:

```typescript
import { Distiller } from './distillation/distiller';
import { DistillationScheduler } from './distillation/scheduler';
import { DistillationQueue } from './distillation/queue';
import { createCallLLM } from './distillation/llm';
```

Update the `CortexInstance` interface to include the queue and scheduler:

```typescript
export interface CortexInstance {
  config: CortexConfig;
  store: CortexStore;
  search: CortexSearch;
  pipeline: IngestionPipeline;
  embedding: EmbeddingProvider;
  sync?: FederationSync;
  distillQueue?: DistillationQueue;
  distillScheduler?: DistillationScheduler;
}
```

In `getCortex()`, after creating the pipeline, wire distillation:

```typescript
  // Initialize distillation if enabled and LLM provider available
  let distillQueue: DistillationQueue | undefined;
  let distillScheduler: DistillationScheduler | undefined;

  if (config.ingestion.distillation) {
    const callLLM = createCallLLM();
    if (callLLM) {
      distillQueue = new DistillationQueue(cortexDir);
      const distiller = new Distiller(store, embedding, callLLM);

      distillScheduler = new DistillationScheduler(async (chunkIds) => {
        const entries = distillQueue!.getEntries(chunkIds);
        if (entries.length === 0) return;

        // Group by layerKey so workspace chunks go to the correct layer
        const byLayer = new Map<string, { texts: string[]; ctx: { workspaceId: number | null; agentType: string } }>();
        for (const e of entries) {
          if (!byLayer.has(e.layerKey)) {
            byLayer.set(e.layerKey, { texts: [], ctx: { workspaceId: e.workspaceId, agentType: e.agentType } });
          }
          byLayer.get(e.layerKey)!.texts.push(e.text);
        }

        for (const [layerKey, { texts, ctx }] of byLayer) {
          await distiller.distill(texts, layerKey, ctx);
        }
        distillQueue!.remove(chunkIds);
      });

      // Re-enqueue any pending items from previous session
      const pendingIds = distillQueue.pendingIds();
      if (pendingIds.length > 0) {
        distillScheduler.enqueue(pendingIds);
      }
    }
  }

  const instance: CortexInstance = {
    config, store, search, pipeline, embedding,
    distillQueue, distillScheduler,
  };
```

- [ ] **Step 2: Add distillation enqueue to pipeline**

In `src/lib/cortex/ingestion/pipeline.ts`, add an optional queue property:

```typescript
import type { DistillationQueue } from '../distillation/queue';
import type { DistillationScheduler } from '../distillation/scheduler';

const DISTILLABLE_TYPES = new Set(['decision', 'error_fix']);

export class IngestionPipeline {
  private hashSet = new Set<string>();
  distillQueue?: DistillationQueue;
  distillScheduler?: DistillationScheduler;
  // ... existing constructor
```

After `await this.store.add(layerKey, unit);` and `result.chunksEmbedded++;`, add:

```typescript
          // Enqueue for distillation if the type qualifies
          if (this.distillQueue && this.distillScheduler && DISTILLABLE_TYPES.has(unit.type)) {
            this.distillQueue.enqueue(unit.id, {
              text: unit.text,
              layerKey,
              workspaceId: unit.workspace_id,
              agentType: unit.agent_type,
            });
            this.distillScheduler.enqueue([unit.id]);
          }
```

Back in `index.ts`, wire the queue and scheduler into the pipeline:

```typescript
  pipeline.distillQueue = distillQueue;
  pipeline.distillScheduler = distillScheduler;
```

- [ ] **Step 3: Run full cortex test suite**

Run: `npx vitest run tests/lib/cortex/`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/index.ts src/lib/cortex/ingestion/pipeline.ts
git commit -m "feat(cortex): wire distillation scheduler into singleton and pipeline"
```

---

## Chunk 5: MCP Server (Layer 5) + Bug Fixes

### Task 10: Create MCP server entry point

**Spec deviation note:** The spec says to adapt `mcp/server.ts` into an HTTP client wrapper. Instead, we leave `mcp/server.ts` unchanged and create thin API routes (`/api/cortex/mcp/tools` and `/api/cortex/mcp/call`) that import from it. The stdio entry point (`bin/cortex-mcp.js`) proxies to these routes. This is a cleaner separation — `server.ts` stays as the canonical tool handler, usable both server-side and via HTTP.

**Files:**
- Create: `bin/cortex-mcp.js`
- Create: `src/app/api/cortex/mcp/tools/route.ts`
- Create: `src/app/api/cortex/mcp/call/route.ts`
- Modify: `bin/terminal-server.js:471-519`

- [ ] **Step 1: Create `bin/cortex-mcp.js`**

This is a stdio MCP server that proxies to the Spaces HTTP API. It reads `SPACES_URL` from the environment (set during registration).

```javascript
#!/usr/bin/env node
'use strict';

const readline = require('readline');

const SPACES_URL = process.env.SPACES_URL || 'http://localhost:3457';
const INTERNAL_TOKEN = process.env.SPACES_INTERNAL_TOKEN || '';

// MCP stdio transport: read JSON-RPC from stdin, write to stdout
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    respond(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'cortex', version: '1.0.0' },
    });
    return;
  }

  if (msg.method === 'notifications/initialized') return; // no response needed

  if (msg.method === 'tools/list') {
    const tools = await fetchJSON('/api/cortex/mcp/tools');
    respond(msg.id, { tools: tools || [] });
    return;
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    const result = await fetchJSON('/api/cortex/mcp/call', {
      method: 'POST',
      body: JSON.stringify({ name, args }),
    });
    respond(msg.id, result || { content: [{ type: 'text', text: 'Error calling tool' }], isError: true });
    return;
  }

  // Unknown method
  respond(msg.id, null, { code: -32601, message: `Method not found: ${msg.method}` });
});

function respond(id, result, error) {
  const msg = { jsonrpc: '2.0', id };
  if (error) msg.error = error;
  else msg.result = result;
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function fetchJSON(path, opts = {}) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (INTERNAL_TOKEN) headers['x-spaces-internal'] = INTERNAL_TOKEN;
    const res = await fetch(`${SPACES_URL}${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
    if (res.ok) return await res.json();
    return null;
  } catch { return null; }
}
```

- [ ] **Step 2: Create MCP API routes**

Create `src/app/api/cortex/mcp/tools/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { CORTEX_TOOLS } from '@/lib/cortex/mcp/server';

export async function GET() {
  return NextResponse.json(CORTEX_TOOLS);
}
```

Create `src/app/api/cortex/mcp/call/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCortex } from '@/lib/cortex';
import { handleToolCall } from '@/lib/cortex/mcp/server';

export async function POST(request: NextRequest) {
  const { name, args } = await request.json();
  const cortex = await getCortex();
  const result = await handleToolCall(name, args || {}, cortex);
  return NextResponse.json(result);
}
```

- [ ] **Step 3: Register MCP server in `writeCortexHookConfig`**

In `bin/terminal-server.js`, in the `writeCortexHookConfig` function (~line 487), after the hooks setup, add MCP server registration:

```javascript
    // Register Cortex MCP server
    const mcpServer = path.resolve(__dirname, 'cortex-mcp.js');
    if (!settings.mcpServers) settings.mcpServers = {};
    settings.mcpServers.cortex = {
      command: 'node',
      args: [mcpServer],
      env: {
        SPACES_URL: `http://localhost:${httpPort || 3457}`,
        SPACES_INTERNAL_TOKEN: (process.env.SPACES_SESSION_SECRET || '').slice(0, 16),
      },
    };
```

The `httpPort` can be read from `httpServer.address().port` if available, or default to 3457.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run tests/lib/cortex/`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add bin/cortex-mcp.js src/app/api/cortex/mcp/ bin/terminal-server.js
git commit -m "feat(cortex): mount MCP server with stdio transport and API routes"
```

---

### Task 11: Fix client-side layer filtering bug

**Spec deviation note:** The spec suggests 3 separate requests (one per tab). Instead, we send 1 request with a `layer` query param based on the active tab. This is simpler (fewer concurrent requests) and results refresh on tab switch.

**Files:**
- Modify: `src/app/api/cortex/search/route.ts`
- Modify: `src/components/cortex/cortex-panel.tsx`

- [ ] **Step 1: Add `layer` param to search API**

In `src/app/api/cortex/search/route.ts`, read a `layer` param and pass it to both browse and search:

```typescript
    const layer = url.searchParams.get('layer') as any;

    // Browse mode
    if (!query) {
      const layers = layer ? [layer] : ['personal', 'workspace', 'team'] as const;
      const results: any[] = [];
      for (const l of layers) {
        const items = await cortex.store.browse(l, limit);
        results.push(...items);
      }
      return NextResponse.json({ results: results.slice(0, limit) });
    }

    // Search mode
    const [queryVector] = await cortex.embedding.embed([query]);
    const results = await cortex.search.search(queryVector, {
      workspaceId: workspaceId ? parseInt(workspaceId, 10) : null,
      layers: layer ? [layer] : undefined,
      limit,
    });
```

- [ ] **Step 2: Update panel to fetch per-layer**

In `src/components/cortex/cortex-panel.tsx`, change `fetchBrowse` and `handleSearch` to include the `layer` param based on `activeTab`:

Replace `fetchBrowse` and `handleSearch` with a single `fetchResults`:

```typescript
  const fetchResults = useCallback(async (searchQuery?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '20', layer: activeTab });
      if (searchQuery) params.set('q', searchQuery);
      const res = await fetch(api(`/api/cortex/search?${params}`));
      if (res.ok) {
        const data = await res.json();
        setResults(data.results || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [activeTab]);
```

Update the `useEffect` to include `activeTab` and call `fetchResults`:

```typescript
  useEffect(() => {
    if (open) {
      fetchStats();
      fetchResults(query || undefined);
    }
  }, [open, activeTab, fetchStats, fetchResults]);
```

Update `handleSearch` to call `fetchResults`:

```typescript
  const handleSearch = () => {
    fetchResults(query.trim() || undefined);
  };
```

Remove the client-side `filtered` variable — `results` are already per-layer. Replace `filtered.map(unit =>` with `results.map(unit =>`.

Remove `const filtered = results.filter(r => r.layer === activeTab);` and use `results` directly in the render.

- [ ] **Step 3: Verify — run build or type check**

Run: `npx tsc --noEmit` (or `npm run build`)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cortex/search/route.ts src/components/cortex/cortex-panel.tsx
git commit -m "fix(cortex): query per-layer instead of client-side filtering"
```

---

### Task 12: Fix exporter hardcoded 384-dim vector

**Files:**
- Modify: `src/lib/cortex/portability/exporter.ts`

- [ ] **Step 1: Read the exporter to find the hardcoded line**

Look for `new Array(384)` in `exporter.ts`.

- [ ] **Step 2: Fix — accept dimensions parameter**

Update the export function signature to accept `dimensions: number` and replace the hardcoded array:

```typescript
const dummyVector = new Array(dimensions).fill(0);
```

Thread `dimensions` from the calling context (the MCP `cortex_export` handler and the API route both have access to `cortex.embedding.dimensions`).

- [ ] **Step 3: Update callers**

Update `src/app/api/cortex/export/route.ts` and `src/lib/cortex/mcp/server.ts` to pass `embedding.dimensions` to the export function.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lib/cortex/portability/exporter.test.ts`
Expected: ALL PASS (update test mocks if dimensions param is now required)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/portability/exporter.ts src/app/api/cortex/export/ src/lib/cortex/mcp/server.ts
git commit -m "fix(cortex): use actual embedding dimensions in exporter instead of hardcoded 384"
```

---

## Final Verification

### Task 13: Full test suite + smoke test

- [ ] **Step 1: Run full cortex test suite**

Run: `npx vitest run tests/lib/cortex/`
Expected: ALL PASS

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit any remaining fixes**

If any tests or build issues found, fix and commit.

- [ ] **Step 5: Final commit summarizing all changes**

If all individual commits are clean, no summary needed. Otherwise:

```bash
git log --oneline -15  # verify commit history looks clean
```
