# Cortex v2 — Pillar 5: Observable Signal Ingestion

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the adapter-based signal ingestion framework and implement the 3 core adapters (Conversations, Git History, Documents). The remaining 4 adapters (PR Reviews, Test Signals, Deployment, Behavioral) are deferred — they require external webhooks/APIs and can be added incrementally since the adapter interface is extensible.

**Architecture:** A new `src/lib/cortex/signals/` module with a `SignalPipeline` class that consumes `SignalEnvelope` objects from any adapter. Each adapter implements a `SignalAdapter` interface with `extract()` (AsyncIterable) and `healthCheck()`. The existing `IngestionPipeline` is wrapped as the Conversation adapter for backward compat. The Git adapter parses `git log` output. The Document adapter watches `docs/**` for ADRs/READMEs.

**Tech Stack:** TypeScript, vitest, child_process (for git), fs (for docs)

**Spec:** `docs/superpowers/specs/2026-03-14-cortex-v2-design.md` — Pillar 5

**Depends on:** Pillars 1-4 (all completed)

**Deferred to future:** PR Review adapter, Test Signal adapter, Deployment adapter, Behavioral Inference adapter

---

## File Structure

```
New files:
├── src/lib/cortex/signals/types.ts              — SignalEnvelope, SignalAdapter interfaces
├── src/lib/cortex/signals/pipeline.ts            — Unified SignalPipeline
├── src/lib/cortex/signals/adapters/conversation.ts — Wraps existing IngestionPipeline
├── src/lib/cortex/signals/adapters/git.ts        — Git history adapter
├── src/lib/cortex/signals/adapters/document.ts   — Document/ADR adapter
├── src/lib/cortex/signals/index.ts               — Barrel export

Test files:
├── tests/lib/cortex/signals/pipeline.test.ts
├── tests/lib/cortex/signals/adapters/git.test.ts
├── tests/lib/cortex/signals/adapters/document.test.ts
```

---

## Chunk 1: Signal Types and Unified Pipeline

### Task 1: Signal types

**Files:**
- Create: `src/lib/cortex/signals/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// src/lib/cortex/signals/types.ts
import type { KnowledgeType, SensitivityClass, Origin, EntityLink } from '../knowledge/types';

export interface SignalEnvelope {
  text: string;
  origin: Origin;
  entities: EntityLink[];
  suggested_type: KnowledgeType;
  suggested_sensitivity: SensitivityClass;
  raw_metadata: Record<string, unknown>;
}

export interface SignalAdapter {
  name: string;
  schedule: 'realtime' | 'polling' | 'webhook' | 'cron';
  extract(): AsyncIterable<SignalEnvelope>;
  healthCheck(): Promise<boolean>;
}

export interface IngestResult {
  accepted: number;
  skipped: number;     // dedup
  errors: string[];
}

/**
 * Graph edge update carried in raw_metadata.
 * Adapters can include these to update the entity graph during ingestion.
 */
export interface EdgeUpdate {
  source_id: string;
  target_id: string;
  relation: string;
  weight_delta: number;  // increment (not absolute)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/cortex/signals/types.ts
git commit -m "feat(cortex): add signal ingestion type definitions"
```

---

### Task 2: Unified SignalPipeline

**Files:**
- Create: `src/lib/cortex/signals/pipeline.ts`
- Create: `tests/lib/cortex/signals/pipeline.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/signals/pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignalPipeline } from '@/lib/cortex/signals/pipeline';
import type { SignalEnvelope } from '@/lib/cortex/signals/types';

const mockStore = {
  add: vi.fn().mockResolvedValue(undefined),
  search: vi.fn().mockResolvedValue([]),
};

const mockEmbedding = {
  embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  dimensions: 3,
  name: 'mock',
  init: vi.fn(),
};

const mockGraph = {
  createEdge: vi.fn(),
  incrementEdgeWeight: vi.fn(),
  getEntity: vi.fn().mockReturnValue(null),
};

const mockResolver = {
  extractEntities: vi.fn().mockReturnValue([]),
};

function makeEnvelope(overrides: Partial<SignalEnvelope> = {}): SignalEnvelope {
  return {
    text: 'Fix auth timeout by increasing pool size',
    origin: { source_type: 'git_commit', source_ref: 'abc123', creator_entity_id: 'person-alice' },
    entities: [],
    suggested_type: 'error_fix',
    suggested_sensitivity: 'internal',
    raw_metadata: {},
    ...overrides,
  };
}

describe('SignalPipeline', () => {
  let pipeline: SignalPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new SignalPipeline({
      store: mockStore as any,
      embedding: mockEmbedding as any,
      graph: mockGraph as any,
      resolver: mockResolver as any,
    });
  });

  it('ingests a signal envelope and stores it', async () => {
    const result = await pipeline.ingest(makeEnvelope());
    expect(result.accepted).toBe(1);
    expect(mockEmbedding.embed).toHaveBeenCalledWith(['Fix auth timeout by increasing pool size']);
    expect(mockStore.add).toHaveBeenCalledTimes(1);
  });

  it('uses suggested_type from envelope', async () => {
    await pipeline.ingest(makeEnvelope({ suggested_type: 'decision' }));
    const addCall = mockStore.add.mock.calls[0];
    expect(addCall[1].type).toBe('decision');
  });

  it('auto-classifies sensitivity (most restrictive wins)', async () => {
    // Text contains API key → confidential, overrides suggested 'internal'
    await pipeline.ingest(makeEnvelope({
      text: 'Set API_KEY=sk-ant-abc123 in production',
      suggested_sensitivity: 'internal',
    }));
    const addCall = mockStore.add.mock.calls[0];
    expect(addCall[1].sensitivity).toBe('confidential');
  });

  it('keeps suggested_sensitivity when more restrictive than auto-classification', async () => {
    await pipeline.ingest(makeEnvelope({
      text: 'General technical note',  // auto-classifies as internal
      suggested_sensitivity: 'restricted',  // more restrictive
    }));
    const addCall = mockStore.add.mock.calls[0];
    expect(addCall[1].sensitivity).toBe('restricted');
  });

  it('processes edge updates from raw_metadata', async () => {
    await pipeline.ingest(makeEnvelope({
      raw_metadata: {
        edge_updates: [
          { source_id: 'person-alice', target_id: 'topic-auth', relation: 'expert_in', weight_delta: 0.05 },
        ],
      },
    }));
    expect(mockGraph.incrementEdgeWeight).toHaveBeenCalledWith(
      'person-alice', 'topic-auth', 'expert_in', 0.05
    );
  });

  it('deduplicates by text hash', async () => {
    const envelope = makeEnvelope();
    await pipeline.ingest(envelope);
    const result = await pipeline.ingest(envelope);  // same text
    expect(result.skipped).toBe(1);
    expect(result.accepted).toBe(0);
    expect(mockStore.add).toHaveBeenCalledTimes(1);  // only first call
  });

  it('ingests batch of envelopes', async () => {
    const envelopes = [
      makeEnvelope({ text: 'First signal' }),
      makeEnvelope({ text: 'Second signal' }),
      makeEnvelope({ text: 'Third signal' }),
    ];
    const result = await pipeline.ingestBatch(envelopes);
    expect(result.accepted).toBe(3);
    expect(mockStore.add).toHaveBeenCalledTimes(3);
  });

  it('handles embedding failures gracefully', async () => {
    mockEmbedding.embed.mockRejectedValueOnce(new Error('embed failed'));
    const result = await pipeline.ingest(makeEnvelope());
    expect(result.errors).toHaveLength(1);
    expect(result.accepted).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/cortex/signals/pipeline.test.ts`

- [ ] **Step 3: Implement SignalPipeline**

```typescript
// src/lib/cortex/signals/pipeline.ts
import { createHash } from 'crypto';
import type { CortexStore } from '../store';
import type { EmbeddingProvider } from '../embeddings';
import type { EntityGraph } from '../graph/entity-graph';
import type { EntityResolver } from '../graph/resolver';
import type { KnowledgeUnit } from '../knowledge/types';
import { classifySensitivity } from '../boundary/classifier';
import { layerToScope, scopeToLayerKey } from '../knowledge/compat';
import type { SignalEnvelope, IngestResult, EdgeUpdate } from './types';

const SENSITIVITY_PRIORITY: Record<string, number> = {
  public: 0, internal: 1, restricted: 2, confidential: 3,
};

export interface SignalPipelineDeps {
  store: CortexStore;
  embedding: EmbeddingProvider;
  graph: EntityGraph;
  resolver: EntityResolver;
}

export class SignalPipeline {
  private hashSet = new Set<string>();
  private deps: SignalPipelineDeps;

  constructor(deps: SignalPipelineDeps) {
    this.deps = deps;
  }

  async ingest(envelope: SignalEnvelope): Promise<IngestResult> {
    const result: IngestResult = { accepted: 0, skipped: 0, errors: [] };

    try {
      // 1. Dedup by text hash
      const hash = createHash('sha256')
        .update(envelope.text.replace(/\s+/g, ' ').trim())
        .digest('hex');

      if (this.hashSet.has(hash)) {
        result.skipped = 1;
        return result;
      }
      this.hashSet.add(hash);

      // 2. Sensitivity: most restrictive wins between suggested and auto-classified
      const autoSensitivity = classifySensitivity(envelope.text);
      const suggestedPriority = SENSITIVITY_PRIORITY[envelope.suggested_sensitivity] ?? 1;
      const autoPriority = SENSITIVITY_PRIORITY[autoSensitivity] ?? 1;
      const sensitivity = suggestedPriority >= autoPriority
        ? envelope.suggested_sensitivity : autoSensitivity;

      // 3. Embed
      const [vector] = await this.deps.embedding.embed([envelope.text]);

      // 4. Build scope from origin
      const scope = layerToScope('personal', null, envelope.origin.creator_entity_id.replace('person-', ''));
      const layerKey = scopeToLayerKey(scope);
      const layer = 'personal' as const;  // default; adapters can override via metadata

      // 5. Build KnowledgeUnit
      const unit: KnowledgeUnit = {
        id: crypto.randomUUID(),
        vector,
        text: envelope.text,
        type: envelope.suggested_type,
        layer,
        workspace_id: (envelope.raw_metadata.workspace_id as number) ?? null,
        session_id: (envelope.raw_metadata.session_id as string) ?? null,
        agent_type: 'claude',
        project_path: (envelope.raw_metadata.project_path as string) ?? null,
        file_refs: (envelope.raw_metadata.file_refs as string[]) ?? [],
        confidence: 0.8,
        created: new Date().toISOString(),
        source_timestamp: new Date().toISOString(),
        stale_score: 0,
        access_count: 0,
        last_accessed: null,
        metadata: { source: envelope.origin.source_type },
        // v2 fields
        scope,
        entity_links: envelope.entities,
        evidence_score: 0.8,
        corroborations: 0,
        contradiction_refs: [],
        sensitivity,
        creator_scope: null,
        origin: envelope.origin,
        propagation_path: [],
      };

      // 6. Store
      await this.deps.store.add(layerKey, unit);
      result.accepted = 1;

      // 7. Process edge updates
      const edgeUpdates = (envelope.raw_metadata.edge_updates as EdgeUpdate[]) ?? [];
      for (const update of edgeUpdates) {
        try {
          this.deps.graph.incrementEdgeWeight(
            update.source_id, update.target_id, update.relation as any, update.weight_delta
          );
        } catch {
          // Edge entities may not exist yet, skip
        }
      }

    } catch (err: any) {
      result.errors.push(err.message);
    }

    return result;
  }

  async ingestBatch(envelopes: SignalEnvelope[]): Promise<IngestResult> {
    const totals: IngestResult = { accepted: 0, skipped: 0, errors: [] };
    for (const envelope of envelopes) {
      const r = await this.ingest(envelope);
      totals.accepted += r.accepted;
      totals.skipped += r.skipped;
      totals.errors.push(...r.errors);
    }
    return totals;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/signals/pipeline.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/signals/pipeline.ts tests/lib/cortex/signals/pipeline.test.ts
git commit -m "feat(cortex): add unified SignalPipeline for multi-source ingestion"
```

---

## Chunk 2: Core Adapters

### Task 3: Conversation adapter (wraps existing pipeline)

**Files:**
- Create: `src/lib/cortex/signals/adapters/conversation.ts`

- [ ] **Step 1: Implement conversation adapter**

This adapter wraps the existing `IngestionPipeline` to produce `SignalEnvelope` objects from Claude Code session transcripts. It does NOT replace the existing pipeline — it wraps it so conversations flow through the unified `SignalPipeline`.

```typescript
// src/lib/cortex/signals/adapters/conversation.ts
import type { SignalAdapter, SignalEnvelope } from '../types';

/**
 * Conversation adapter — wraps the learn hook's output format.
 * This is a "pull" adapter: it doesn't actively extract.
 * Instead, the learn hook POSTs to the knowledge API, and this adapter
 * can be used to convert raw session messages into SignalEnvelopes
 * for batch processing.
 */
export class ConversationAdapter implements SignalAdapter {
  name = 'conversation';
  schedule = 'realtime' as const;

  async *extract(): AsyncIterable<SignalEnvelope> {
    // No-op for the conversation adapter.
    // Conversations are ingested in real-time via the learn hook → knowledge API.
    // This adapter exists to satisfy the interface and for future batch reprocessing.
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  /**
   * Convert a raw Q&A pair into a SignalEnvelope (used by learn hook).
   */
  static fromQA(question: string, answer: string, sessionId: string, type: string = 'conversation'): SignalEnvelope {
    return {
      text: `Q: ${question}\nA: ${answer}`,
      origin: {
        source_type: 'conversation',
        source_ref: sessionId,
        creator_entity_id: 'person-default-user',
      },
      entities: [],
      suggested_type: type as any,
      suggested_sensitivity: 'internal',
      raw_metadata: { session_id: sessionId },
    };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/cortex/signals/adapters/conversation.ts
git commit -m "feat(cortex): add conversation signal adapter"
```

---

### Task 4: Git history adapter

**Files:**
- Create: `src/lib/cortex/signals/adapters/git.ts`
- Create: `tests/lib/cortex/signals/adapters/git.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/signals/adapters/git.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GitAdapter, parseGitLog } from '@/lib/cortex/signals/adapters/git';
import type { SignalEnvelope } from '@/lib/cortex/signals/types';

describe('parseGitLog', () => {
  it('parses a commit into a SignalEnvelope', () => {
    const logEntry = {
      sha: 'abc123def',
      author: 'alice@acme.com',
      authorName: 'Alice Smith',
      date: '2026-03-15T10:00:00Z',
      message: 'fix(auth): increase connection pool to handle concurrent load\n\nThe default pool of 10 was exhausted under peak traffic.',
      files: ['src/services/auth/pool.ts', 'config/auth.yaml'],
    };

    const envelopes = parseGitLog(logEntry);
    expect(envelopes.length).toBeGreaterThanOrEqual(1);

    const main = envelopes[0];
    expect(main.origin.source_type).toBe('git_commit');
    expect(main.origin.source_ref).toBe('abc123def');
    expect(main.suggested_type).toBe('error_fix');  // "fix" in message
    expect(main.text).toContain('increase connection pool');
    expect(main.raw_metadata.file_refs).toEqual(['src/services/auth/pool.ts', 'config/auth.yaml']);
  });

  it('classifies refactor commits as decisions', () => {
    const logEntry = {
      sha: 'def456',
      author: 'bob@acme.com',
      authorName: 'Bob',
      date: '2026-03-15T11:00:00Z',
      message: 'refactor: migrate auth from Express to Fastify',
      files: ['src/server.ts'],
    };

    const envelopes = parseGitLog(logEntry);
    expect(envelopes[0].suggested_type).toBe('decision');
  });

  it('classifies generic commits as context', () => {
    const logEntry = {
      sha: 'ghi789',
      author: 'charlie@acme.com',
      authorName: 'Charlie',
      date: '2026-03-15T12:00:00Z',
      message: 'update dependencies',
      files: ['package.json'],
    };

    const envelopes = parseGitLog(logEntry);
    expect(envelopes[0].suggested_type).toBe('context');
  });

  it('includes edge updates for author TOUCHES files', () => {
    const logEntry = {
      sha: 'jkl012',
      author: 'alice@acme.com',
      authorName: 'Alice Smith',
      date: '2026-03-15T13:00:00Z',
      message: 'feat: add new endpoint',
      files: ['src/api/users.ts'],
    };

    const envelopes = parseGitLog(logEntry);
    const edgeUpdates = envelopes[0].raw_metadata.edge_updates as any[];
    expect(edgeUpdates).toBeDefined();
    expect(edgeUpdates.length).toBeGreaterThanOrEqual(1);
    expect(edgeUpdates[0].relation).toBe('touches');
  });

  it('skips merge commits', () => {
    const logEntry = {
      sha: 'mno345',
      author: 'alice@acme.com',
      authorName: 'Alice',
      date: '2026-03-15T14:00:00Z',
      message: 'Merge branch \'feature/foo\' into main',
      files: [],
    };

    const envelopes = parseGitLog(logEntry);
    expect(envelopes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement git adapter**

```typescript
// src/lib/cortex/signals/adapters/git.ts
import type { SignalAdapter, SignalEnvelope, EdgeUpdate } from '../types';
import { slugify } from '../../graph/types';

export interface GitLogEntry {
  sha: string;
  author: string;      // email
  authorName: string;
  date: string;        // ISO timestamp
  message: string;
  files: string[];
}

const FIX_PATTERNS = [/^fix[:(]/, /\bfix\b/i, /\bbug\b/i, /\bhotfix\b/i];
const DECISION_PATTERNS = [/^refactor[:(]/, /\bmigrat/i, /\bswitch\s+to\b/i, /\breplace\b.*\bwith\b/i, /^feat[:(]/];
const MERGE_PATTERN = /^Merge\s+(branch|pull\s+request|remote)/i;

/**
 * Parse a git log entry into SignalEnvelopes.
 */
export function parseGitLog(entry: GitLogEntry): SignalEnvelope[] {
  // Skip merge commits
  if (MERGE_PATTERN.test(entry.message)) return [];

  // Skip very short messages
  const body = entry.message.trim();
  if (body.length < 10) return [];

  // Classify commit type
  let suggestedType: string = 'context';
  if (FIX_PATTERNS.some(p => p.test(body))) suggestedType = 'error_fix';
  else if (DECISION_PATTERNS.some(p => p.test(body))) suggestedType = 'decision';

  const authorSlug = slugify(entry.authorName);
  const creatorEntityId = `person-${authorSlug}`;

  // Build edge updates: author TOUCHES each file
  const edgeUpdates: EdgeUpdate[] = entry.files.map(file => ({
    source_id: creatorEntityId,
    target_id: `module-${slugify(file)}`,
    relation: 'touches',
    weight_delta: 0.05,
  }));

  const envelope: SignalEnvelope = {
    text: body,
    origin: {
      source_type: 'git_commit',
      source_ref: entry.sha,
      creator_entity_id: creatorEntityId,
    },
    entities: [],
    suggested_type: suggestedType as any,
    suggested_sensitivity: 'internal',
    raw_metadata: {
      file_refs: entry.files,
      edge_updates: edgeUpdates,
      author_email: entry.author,
      commit_date: entry.date,
    },
  };

  return [envelope];
}

/**
 * Git adapter — extracts knowledge from git history.
 * Uses `git log` to scan recent commits.
 */
export class GitAdapter implements SignalAdapter {
  name = 'git';
  schedule = 'polling' as const;

  constructor(private repoPath: string, private sinceDate?: string) {}

  async *extract(): AsyncIterable<SignalEnvelope> {
    const { execSync } = await import('child_process');
    const since = this.sinceDate ?? new Date(Date.now() - 86400000).toISOString();  // default: last 24h

    try {
      const log = execSync(
        `git log --since="${since}" --format="%H|%ae|%an|%aI|%s" --name-only`,
        { cwd: this.repoPath, encoding: 'utf-8', timeout: 10000 }
      );

      const entries = this.parseLogOutput(log);
      for (const entry of entries) {
        for (const envelope of parseGitLog(entry)) {
          yield envelope;
        }
      }
    } catch {
      // Git not available or not a repo, yield nothing
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { execSync } = await import('child_process');
      execSync('git rev-parse HEAD', { cwd: this.repoPath, encoding: 'utf-8', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  private parseLogOutput(log: string): GitLogEntry[] {
    const entries: GitLogEntry[] = [];
    const lines = log.split('\n');
    let current: GitLogEntry | null = null;

    for (const line of lines) {
      if (line.includes('|') && line.split('|').length >= 5) {
        if (current) entries.push(current);
        const [sha, author, authorName, date, ...messageParts] = line.split('|');
        current = {
          sha, author, authorName, date,
          message: messageParts.join('|'),
          files: [],
        };
      } else if (line.trim() && current) {
        current.files.push(line.trim());
      }
    }

    if (current) entries.push(current);
    return entries;
  }
}
```

- [ ] **Step 3: Run tests, commit**

Run: `npx vitest run tests/lib/cortex/signals/adapters/git.test.ts`

```bash
git commit -m "feat(cortex): add git history signal adapter"
```

---

### Task 5: Document adapter

**Files:**
- Create: `src/lib/cortex/signals/adapters/document.ts`
- Create: `tests/lib/cortex/signals/adapters/document.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/signals/adapters/document.test.ts
import { describe, it, expect } from 'vitest';
import { parseDocument, classifyDocument } from '@/lib/cortex/signals/adapters/document';

describe('classifyDocument', () => {
  it('classifies ADR files as decisions', () => {
    expect(classifyDocument('docs/adr/001-use-postgres.md')).toBe('decision');
    expect(classifyDocument('docs/ADR-002.md')).toBe('decision');
  });

  it('classifies runbook files as pattern', () => {
    expect(classifyDocument('docs/runbooks/deploy-production.md')).toBe('pattern');
  });

  it('classifies README as context', () => {
    expect(classifyDocument('README.md')).toBe('context');
    expect(classifyDocument('docs/getting-started.md')).toBe('context');
  });
});

describe('parseDocument', () => {
  it('creates envelope from document content', () => {
    const envelope = parseDocument({
      path: 'docs/adr/001-use-postgres.md',
      content: '# ADR-001: Use PostgreSQL\n\nWe decided to use PostgreSQL for all new services due to its reliability and JSON support.',
    });

    expect(envelope.origin.source_type).toBe('document');
    expect(envelope.origin.source_ref).toBe('docs/adr/001-use-postgres.md');
    expect(envelope.suggested_type).toBe('decision');
    expect(envelope.text).toContain('PostgreSQL');
    expect(envelope.suggested_sensitivity).toBe('internal');
  });

  it('truncates very long documents', () => {
    const longContent = 'x'.repeat(10000);
    const envelope = parseDocument({
      path: 'docs/guide.md',
      content: longContent,
    });
    expect(envelope.text.length).toBeLessThanOrEqual(4000);
  });

  it('sets higher authority via raw_metadata', () => {
    const envelope = parseDocument({
      path: 'docs/adr/001.md',
      content: 'ADR content',
    });
    expect(envelope.raw_metadata.authority_boost).toBe(true);
  });
});
```

- [ ] **Step 2: Implement document adapter**

```typescript
// src/lib/cortex/signals/adapters/document.ts
import type { SignalAdapter, SignalEnvelope } from '../types';
import type { KnowledgeType } from '../../knowledge/types';

const MAX_DOC_LENGTH = 4000;

const DOC_TYPE_PATTERNS: [RegExp, KnowledgeType][] = [
  [/\badr[s]?\b/i, 'decision'],
  [/\bADR[-_]/i, 'decision'],
  [/\brunbook/i, 'pattern'],
  [/\bplaybook/i, 'pattern'],
  [/\bREADME/i, 'context'],
  [/\bguide/i, 'context'],
  [/\bchangelog/i, 'summary'],
];

export function classifyDocument(filepath: string): KnowledgeType {
  for (const [pattern, type] of DOC_TYPE_PATTERNS) {
    if (pattern.test(filepath)) return type;
  }
  return 'context';
}

export interface DocumentInput {
  path: string;
  content: string;
}

export function parseDocument(input: DocumentInput): SignalEnvelope {
  const type = classifyDocument(input.path);
  const text = input.content.length > MAX_DOC_LENGTH
    ? input.content.slice(0, MAX_DOC_LENGTH)
    : input.content;

  return {
    text,
    origin: {
      source_type: 'document',
      source_ref: input.path,
      creator_entity_id: 'person-default-user',
    },
    entities: [],
    suggested_type: type,
    suggested_sensitivity: 'internal',
    raw_metadata: {
      file_path: input.path,
      authority_boost: true,  // documents have higher authority
    },
  };
}

/**
 * Document adapter — scans docs directories for markdown files.
 */
export class DocumentAdapter implements SignalAdapter {
  name = 'document';
  schedule = 'polling' as const;

  constructor(private docPaths: string[]) {}

  async *extract(): AsyncIterable<SignalEnvelope> {
    const fs = await import('fs');
    const path = await import('path');

    for (const docDir of this.docPaths) {
      try {
        const files = this.walkDir(docDir, fs, path);
        for (const file of files) {
          if (!file.endsWith('.md')) continue;
          try {
            const content = fs.readFileSync(file, 'utf-8');
            yield parseDocument({ path: file, content });
          } catch {
            // File not readable, skip
          }
        }
      } catch {
        // Directory not accessible, skip
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    const fs = await import('fs');
    return this.docPaths.some(p => {
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    });
  }

  private walkDir(dir: string, fs: any, path: any): string[] {
    const results: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          results.push(...this.walkDir(full, fs, path));
        } else if (entry.isFile()) {
          results.push(full);
        }
      }
    } catch { /* not accessible */ }
    return results;
  }
}
```

- [ ] **Step 3: Run tests, commit**

Run: `npx vitest run tests/lib/cortex/signals/adapters/document.test.ts`

```bash
git commit -m "feat(cortex): add document signal adapter"
```

---

## Chunk 3: Integration and Barrel Export

### Task 6: Barrel export and CortexInstance integration

**Files:**
- Create: `src/lib/cortex/signals/index.ts`
- Modify: `src/lib/cortex/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// src/lib/cortex/signals/index.ts
export { SignalPipeline } from './pipeline';
export type { SignalPipelineDeps } from './pipeline';
export { ConversationAdapter } from './adapters/conversation';
export { GitAdapter, parseGitLog } from './adapters/git';
export type { GitLogEntry } from './adapters/git';
export { DocumentAdapter, parseDocument, classifyDocument } from './adapters/document';
export type { DocumentInput } from './adapters/document';
export type { SignalEnvelope, SignalAdapter, IngestResult, EdgeUpdate } from './types';
```

- [ ] **Step 2: Add SignalPipeline to CortexInstance**

Read `src/lib/cortex/index.ts`. Add:

1. Import: `import { SignalPipeline } from './signals/pipeline';`
2. Add `signalPipeline?: SignalPipeline` to CortexInstance interface
3. In getCortex(), after graph/resolver initialization:

```typescript
const signalPipeline = new SignalPipeline({ store, embedding, graph, resolver });
```

4. Include in instance object.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run tests/lib/cortex/`

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/signals/index.ts src/lib/cortex/index.ts
git commit -m "feat(cortex): add signal module barrel export and CortexInstance integration"
```

---

## Summary

| Task | Component | Tests | Status |
|------|-----------|-------|--------|
| 1 | Signal types | — | |
| 2 | Unified SignalPipeline | 8 | |
| 3 | Conversation adapter | — | |
| 4 | Git history adapter | 5 | |
| 5 | Document adapter | 6 | |
| 6 | Barrel export + integration | regression | |

**Total: 6 tasks, ~19 new tests, 3 chunks**

**Deferred adapters** (require external APIs/webhooks — implement when infrastructure is ready):
- PR Review adapter (GitHub API)
- Test Signal adapter (CI pipeline webhook)
- Deployment adapter (deploy system webhook)
- Behavioral Inference adapter (daily cron analyzing accumulated signals)

Each deferred adapter = implement `SignalAdapter` interface + test, zero changes to SignalPipeline.
