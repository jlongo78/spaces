# Cortex v2 — Pillar 2: Knowledge Unit Schema Evolution

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the KnowledgeUnit schema from flat `layer` to graph-aware `scope`, add entity links, evidence tracking, sensitivity classification, and provenance — while maintaining full backward compatibility with the v1 API and existing ~542 knowledge units.

**Architecture:** The `layer` field is KEPT for backward compatibility (spec says "removed" but we intentionally keep it as a derived field to avoid breaking existing consumers — this is a documented deviation). New v2 fields (`scope`, `entity_links`, `evidence_score`, etc.) are added as nullable Arrow columns. Existing LanceDB tables are migrated in-place using LanceDB's `addColumns()` API in a migration step during `store.init()`. A compatibility layer maps v1 `layer` params to v2 `scope` in all API routes, MCP tools, and hooks.

**Tech Stack:** TypeScript, LanceDB (Arrow schema), vitest

**Spec:** `docs/superpowers/specs/2026-03-14-cortex-v2-design.md` — Pillar 2

**Depends on:** Pillar 1 (Entity Graph) — completed

---

## File Structure

```
Modified files:
├── src/lib/cortex/knowledge/types.ts    — Add v2 interfaces, keep v1 layer for compat (intentional spec deviation)
├── src/lib/cortex/knowledge/evidence.ts — NEW: evidence score computation
├── src/lib/cortex/knowledge/compat.ts   — NEW: v1↔v2 layer/scope mapping
├── src/lib/cortex/store.ts              — Evolve Arrow schema, add v2 fields, migrate existing tables
├── src/lib/cortex/store-migration.ts    — NEW: LanceDB table schema migration (addColumns)
├── src/lib/cortex/retrieval/search.ts   — Use scope instead of layer for weights
├── src/lib/cortex/retrieval/scoring.ts  — Add evidence_score to formula
├── src/app/api/cortex/knowledge/route.ts — Accept both layer and scope params
├── src/lib/cortex/mcp/server.ts         — Accept both layer and scope in tools
├── bin/cortex-learn-hook.js             — Map 'personal' to scope format

Test files:
├── tests/lib/cortex/knowledge/evidence.test.ts  — Evidence score computation
├── tests/lib/cortex/knowledge/compat.test.ts     — v1↔v2 mapping
├── tests/lib/cortex/knowledge/types.test.ts      — Updated for v2 types
├── tests/lib/cortex/store.test.ts                — Updated for v2 schema
├── tests/lib/cortex/retrieval/search.test.ts     — Updated for scope-based weights
```

---

## Chunk 1: New Types and Compatibility Layer

### Task 1: Add v2 type definitions

**Files:**
- Modify: `src/lib/cortex/knowledge/types.ts`

- [ ] **Step 1: Add new interfaces after existing ones (keep all v1 types for backward compat)**

Add these types to `src/lib/cortex/knowledge/types.ts` below the existing interfaces:

```typescript
// --- v2 Schema Extensions ---

export const SCOPE_LEVELS = ['personal', 'team', 'department', 'organization'] as const;
export type ScopeLevel = typeof SCOPE_LEVELS[number];

export interface Scope {
  level: ScopeLevel;
  entity_id: string;  // format: {type}-{slug}
}

export interface EntityLink {
  entity_id: string;
  entity_type: EntityType;  // imported from graph module
  relation: 'created_by' | 'about' | 'scoped_to' | 'derived_from';
  weight: number;  // 0-1
}
```

Add this import at the top of types.ts:
```typescript
import type { EntityType } from '@/lib/cortex/graph/types';

export const SENSITIVITY_CLASSES = ['public', 'internal', 'restricted', 'confidential'] as const;
export type SensitivityClass = typeof SENSITIVITY_CLASSES[number];

export interface ScopeOverride {
  max_level: ScopeLevel;
}

export const ORIGIN_SOURCE_TYPES = [
  'conversation', 'git_commit', 'pr_review', 'document',
  'behavioral', 'distillation', 'manual',
] as const;
export type OriginSourceType = typeof ORIGIN_SOURCE_TYPES[number];

export interface Origin {
  source_type: OriginSourceType;
  source_ref: string;
  creator_entity_id: string;
}

export interface PropHop {
  from_scope: Scope;
  to_scope: Scope;
  reason: 'evidence_threshold' | 'policy_push' | 'manual_promote';
  timestamp: string;
  confidence_at_hop: number;
}

export function isValidScopeLevel(s: string): s is ScopeLevel {
  return SCOPE_LEVELS.includes(s as ScopeLevel);
}

export function isValidSensitivity(s: string): s is SensitivityClass {
  return SENSITIVITY_CLASSES.includes(s as SensitivityClass);
}
```

- [ ] **Step 1b: Update HOP_DECAY_FACTOR from 0.8 to 0.85**

Per spec Key Constants table, update the existing `HOP_DECAY_FACTOR` constant in types.ts from `0.8` to `0.85` (increased to preserve more signal across propagation hops).

- [ ] **Step 2: Extend KnowledgeUnit interface with optional v2 fields**

Add new optional fields to the existing `KnowledgeUnit` interface (keeping `layer` for backward compat):

```typescript
export interface KnowledgeUnit {
  // ... all existing v1 fields unchanged ...
  layer: Layer;  // KEPT for backward compat (derived from scope on read)

  // v2 fields (optional — null/default when reading v1 data)
  scope?: Scope;
  entity_links?: EntityLink[];
  evidence_score?: number;
  corroborations?: number;
  contradiction_refs?: string[];
  sensitivity?: SensitivityClass;
  creator_scope?: ScopeOverride | null;
  origin?: Origin;
  propagation_path?: PropHop[];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/cortex/knowledge/types.ts
git commit -m "feat(cortex): add v2 knowledge unit type definitions"
```

---

### Task 2: Create v1↔v2 compatibility layer

**Files:**
- Create: `src/lib/cortex/knowledge/compat.ts`
- Create: `tests/lib/cortex/knowledge/compat.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/knowledge/compat.test.ts
import { describe, it, expect } from 'vitest';
import {
  layerToScope,
  scopeToLayer,
  scopeToLayerKey,
  layerKeyToScope,
} from '@/lib/cortex/knowledge/compat';

describe('v1↔v2 Compatibility', () => {
  describe('layerToScope', () => {
    it('maps personal to personal scope', () => {
      const scope = layerToScope('personal', null, 'default-user');
      expect(scope).toEqual({ level: 'personal', entity_id: 'person-default-user' });
    });

    it('maps workspace to team scope', () => {
      const scope = layerToScope('workspace', 42);
      expect(scope).toEqual({ level: 'team', entity_id: 'team-default' });
    });

    it('maps team to organization scope', () => {
      const scope = layerToScope('team', null);
      expect(scope).toEqual({ level: 'organization', entity_id: 'organization-default' });
    });
  });

  describe('scopeToLayer', () => {
    it('maps personal scope to personal layer', () => {
      expect(scopeToLayer({ level: 'personal', entity_id: 'person-alice' })).toBe('personal');
    });

    it('maps team scope to workspace layer', () => {
      expect(scopeToLayer({ level: 'team', entity_id: 'team-platform' })).toBe('workspace');
    });

    it('maps department scope to team layer', () => {
      expect(scopeToLayer({ level: 'department', entity_id: 'dept-eng' })).toBe('team');
    });

    it('maps organization scope to team layer', () => {
      expect(scopeToLayer({ level: 'organization', entity_id: 'org-acme' })).toBe('team');
    });
  });

  describe('scopeToLayerKey', () => {
    it('maps personal scope to personal key', () => {
      expect(scopeToLayerKey({ level: 'personal', entity_id: 'person-alice' })).toBe('personal');
    });

    it('maps team scope with workspace_id to workspace/id key', () => {
      expect(scopeToLayerKey({ level: 'team', entity_id: 'team-platform' }, 42)).toBe('workspace/42');
    });

    it('maps team scope without workspace_id to team key', () => {
      expect(scopeToLayerKey({ level: 'team', entity_id: 'team-platform' })).toBe('team');
    });

    it('maps organization scope to team key', () => {
      expect(scopeToLayerKey({ level: 'organization', entity_id: 'org-acme' })).toBe('team');
    });
  });

  describe('layerKeyToScope', () => {
    it('maps personal key to personal scope', () => {
      const scope = layerKeyToScope('personal', 'default-user');
      expect(scope).toEqual({ level: 'personal', entity_id: 'person-default-user' });
    });

    it('maps workspace/id key to team scope', () => {
      const scope = layerKeyToScope('workspace/42');
      expect(scope).toEqual({ level: 'team', entity_id: 'team-default' });
    });

    it('maps team key to organization scope', () => {
      const scope = layerKeyToScope('team');
      expect(scope).toEqual({ level: 'organization', entity_id: 'organization-default' });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/cortex/knowledge/compat.test.ts`

- [ ] **Step 3: Implement compatibility layer**

```typescript
// src/lib/cortex/knowledge/compat.ts
import type { Layer, Scope, ScopeLevel } from './types';

/**
 * Convert v1 layer to v2 scope.
 * personal → personal scope, workspace → team scope, team → organization scope.
 */
export function layerToScope(
  layer: Layer,
  workspaceId?: number | null,
  userId?: string,
): Scope {
  switch (layer) {
    case 'personal':
      return { level: 'personal', entity_id: `person-${userId ?? 'default-user'}` };
    case 'workspace':
      return { level: 'team', entity_id: 'team-default' };
    case 'team':
      return { level: 'organization', entity_id: 'organization-default' };
  }
}

/**
 * Convert v2 scope back to v1 layer (for backward compat).
 * personal → personal, team → workspace, department/organization → team.
 */
export function scopeToLayer(scope: Scope): Layer {
  switch (scope.level) {
    case 'personal': return 'personal';
    case 'team': return 'workspace';
    case 'department':
    case 'organization': return 'team';
  }
}

/**
 * Convert v2 scope to a LanceDB layer key (storage path).
 * Maintains compatibility with existing store.layerPath() logic.
 */
export function scopeToLayerKey(scope: Scope, workspaceId?: number | null): string {
  switch (scope.level) {
    case 'personal': return 'personal';
    case 'team':
      return workspaceId ? `workspace/${workspaceId}` : 'team';
    case 'department':
    case 'organization':
      return 'team';
  }
}

/**
 * Convert a LanceDB layer key back to a v2 scope.
 */
export function layerKeyToScope(layerKey: string, userId?: string): Scope {
  if (layerKey === 'personal') {
    return { level: 'personal', entity_id: `person-${userId ?? 'default-user'}` };
  }
  if (layerKey.startsWith('workspace/')) {
    return { level: 'team', entity_id: 'team-default' };
  }
  // 'team' key → organization scope
  return { level: 'organization', entity_id: 'organization-default' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/knowledge/compat.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/knowledge/compat.ts tests/lib/cortex/knowledge/compat.test.ts
git commit -m "feat(cortex): add v1↔v2 layer/scope compatibility mapping"
```

---

### Task 3: Evidence score computation

**Files:**
- Create: `src/lib/cortex/knowledge/evidence.ts`
- Create: `tests/lib/cortex/knowledge/evidence.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/knowledge/evidence.test.ts
import { describe, it, expect } from 'vitest';
import { computeEvidenceScore, AUTHORITY_FACTORS } from '@/lib/cortex/knowledge/evidence';

describe('computeEvidenceScore', () => {
  it('returns base confidence for fresh unit with no interactions', () => {
    const score = computeEvidenceScore({
      baseConfidence: 0.8,
      corroborations: 0,
      accessCount: 0,
      authorityFactor: 1.0,
      contradictionCount: 0,
    });
    expect(score).toBeCloseTo(0.8);
  });

  it('increases with corroborations', () => {
    const base = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 0, accessCount: 0, authorityFactor: 1.0, contradictionCount: 0,
    });
    const withCorr = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 3, accessCount: 0, authorityFactor: 1.0, contradictionCount: 0,
    });
    expect(withCorr).toBeGreaterThan(base);
  });

  it('increases with access count (diminishing returns)', () => {
    const low = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 0, accessCount: 5, authorityFactor: 1.0, contradictionCount: 0,
    });
    const high = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 0, accessCount: 50, authorityFactor: 1.0, contradictionCount: 0,
    });
    expect(high).toBeGreaterThan(low);
    // Capped at 50 — going higher has no effect
    const over = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 0, accessCount: 100, authorityFactor: 1.0, contradictionCount: 0,
    });
    expect(over).toBeCloseTo(high);
  });

  it('decreases with contradictions', () => {
    const clean = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 2, accessCount: 10, authorityFactor: 1.0, contradictionCount: 0,
    });
    const contested = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 2, accessCount: 10, authorityFactor: 1.0, contradictionCount: 2,
    });
    expect(contested).toBeLessThan(clean);
  });

  it('caps corroboration contribution at 10', () => {
    const at10 = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 10, accessCount: 0, authorityFactor: 1.0, contradictionCount: 0,
    });
    const at20 = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 20, accessCount: 0, authorityFactor: 1.0, contradictionCount: 0,
    });
    expect(at20).toBeCloseTo(at10);  // no additional benefit beyond 10
  });

  it('is boosted by authority factor', () => {
    const conversation = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 0, accessCount: 0, authorityFactor: AUTHORITY_FACTORS.conversation, contradictionCount: 0,
    });
    const document = computeEvidenceScore({
      baseConfidence: 0.8, corroborations: 0, accessCount: 0, authorityFactor: AUTHORITY_FACTORS.document, contradictionCount: 0,
    });
    expect(document).toBeGreaterThan(conversation);
  });

  it('is capped at 1.0', () => {
    const score = computeEvidenceScore({
      baseConfidence: 0.95, corroborations: 10, accessCount: 50, authorityFactor: 1.3, contradictionCount: 0,
    });
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('never goes below 0', () => {
    const score = computeEvidenceScore({
      baseConfidence: 0.1, corroborations: 0, accessCount: 0, authorityFactor: 1.0, contradictionCount: 10,
    });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/cortex/knowledge/evidence.test.ts`

- [ ] **Step 3: Implement evidence score**

```typescript
// src/lib/cortex/knowledge/evidence.ts

export const AUTHORITY_FACTORS = {
  conversation: 1.0,
  git_commit: 1.1,
  pr_review: 1.1,
  document: 1.2,
  behavioral: 1.0,
  distillation: 1.1,
  manual: 1.3,
} as const;

export interface EvidenceScoreInput {
  baseConfidence: number;
  corroborations: number;
  accessCount: number;
  authorityFactor: number;
  contradictionCount: number;
}

/**
 * Compute evidence score (0-1) from knowledge unit metrics.
 *
 * Formula from spec:
 * evidence_score = min(1.0,
 *   base_confidence
 *   × (1 + 0.1 × corroborations)
 *   × (1 + 0.01 × min(access_count, 50))
 *   × authority_factor
 *   ÷ (1 + 0.5 × contradiction_count)
 * )
 */
export function computeEvidenceScore(input: EvidenceScoreInput): number {
  const { baseConfidence, corroborations, accessCount, authorityFactor, contradictionCount } = input;

  const corroborationBoost = 1 + 0.1 * Math.min(corroborations, 10);
  const accessBoost = 1 + 0.01 * Math.min(accessCount, 50);
  const contradictionPenalty = 1 + 0.5 * contradictionCount;

  const raw = (baseConfidence * corroborationBoost * accessBoost * authorityFactor) / contradictionPenalty;

  return Math.max(0, Math.min(1.0, raw));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/knowledge/evidence.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/knowledge/evidence.ts tests/lib/cortex/knowledge/evidence.test.ts
git commit -m "feat(cortex): add evidence score computation"
```

---

## Chunk 2: LanceDB Schema Evolution and Store Updates

### Task 4: Evolve Arrow schema with v2 fields and table migration

**Files:**
- Create: `src/lib/cortex/store-migration.ts`
- Modify: `src/lib/cortex/store.ts`
- Modify: `tests/lib/cortex/store.test.ts`

> **CRITICAL:** LanceDB is strict about schema — you cannot add records with columns that don't exist in the table's schema. Existing v1 tables lack the 9 new v2 columns. We must migrate existing tables by adding the new columns before any v2 writes.

- [ ] **Step 1: Read the current store.ts**

Read `src/lib/cortex/store.ts` to understand:
- The `buildSchema(dimensions)` function (Arrow field definitions)
- The `unitToRecord` serialization
- The deserialization in `search()` and `browse()`
- The `updateAccessCount()` method (delete + re-add pattern)
- How `getConnection()` opens tables

- [ ] **Step 1b: Create store-migration.ts**

```typescript
// src/lib/cortex/store-migration.ts
import type { Table } from '@lancedb/lancedb';

/**
 * V2 columns to add to existing LanceDB tables.
 * Each entry: [column_name, sql_expression_for_default_value]
 */
const V2_COLUMNS: [string, string][] = [
  ['scope', "'null'"],                    // JSON string, null for v1 data
  ['entity_links', "'[]'"],               // JSON array string
  ['evidence_score', '0.5'],              // float default
  ['corroborations', '0'],                // int default
  ['contradiction_refs', "'[]'"],         // JSON array string
  ['sensitivity', "'internal'"],          // string default
  ['creator_scope', "'null'"],            // JSON string, null
  ['origin', "'null'"],                   // JSON string, null
  ['propagation_path', "'[]'"],           // JSON array string
];

/**
 * Migrate a LanceDB table to v2 schema by adding missing columns.
 * Safe to call repeatedly — checks column existence before adding.
 */
export async function migrateTableToV2(table: Table): Promise<void> {
  const schema = await table.schema;
  const existingFields = new Set(schema.fields.map(f => f.name));

  for (const [colName, defaultExpr] of V2_COLUMNS) {
    if (!existingFields.has(colName)) {
      try {
        await table.addColumns([{ name: colName, valueSql: defaultExpr }]);
      } catch {
        // Column may have been added concurrently, ignore
      }
    }
  }
}
```

This uses LanceDB's `table.addColumns()` API to add nullable columns with default values to existing tables in-place, without needing to read/drop/recreate.

- [ ] **Step 2: Write a failing test for v2 fields**

Add to `tests/lib/cortex/store.test.ts`:

```typescript
describe('CortexStore — v2 fields', () => {
  let tmpDir: string;
  let store: CortexStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-store-'));
    store = new CortexStore(tmpDir);
    await store.init(384);
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves v2 fields', async () => {
    const vector = new Array(384).fill(0).map(() => Math.random());
    const unit = {
      id: 'v2-test-1',
      vector,
      text: 'Auth uses JWT with refresh tokens',
      type: 'decision' as const,
      layer: 'personal' as const,
      workspace_id: null,
      session_id: 'sess-1',
      agent_type: 'claude' as const,
      project_path: '/project',
      file_refs: ['src/auth.ts'],
      confidence: 0.85,
      created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(),
      stale_score: 0,
      access_count: 0,
      last_accessed: null,
      metadata: {},
      // v2 fields
      scope: { level: 'personal' as const, entity_id: 'person-alice' },
      entity_links: [
        { entity_id: 'topic-auth', entity_type: 'topic', relation: 'about' as const, weight: 0.9 },
      ],
      evidence_score: 0.72,
      corroborations: 2,
      contradiction_refs: ['other-id-1'],
      sensitivity: 'internal' as const,
      creator_scope: null,
      origin: { source_type: 'conversation' as const, source_ref: 'sess-1', creator_entity_id: 'person-alice' },
      propagation_path: [],
    };

    await store.add('personal', unit);
    const results = await store.search('personal', vector, 5);
    expect(results).toHaveLength(1);

    const result = results[0];
    expect(result.scope).toEqual({ level: 'personal', entity_id: 'person-alice' });
    expect(result.entity_links).toHaveLength(1);
    expect(result.entity_links![0].entity_id).toBe('topic-auth');
    expect(result.evidence_score).toBeCloseTo(0.72);
    expect(result.corroborations).toBe(2);
    expect(result.contradiction_refs).toEqual(['other-id-1']);
    expect(result.sensitivity).toBe('internal');
    expect(result.origin?.source_type).toBe('conversation');
  });

  it('reads v1 data with default v2 fields', async () => {
    const vector = new Array(384).fill(0).map(() => Math.random());
    // Store a unit WITHOUT v2 fields (simulating v1 data)
    const unit = {
      id: 'v1-test-1',
      vector,
      text: 'Old v1 knowledge',
      type: 'context' as const,
      layer: 'personal' as const,
      workspace_id: null,
      session_id: null,
      agent_type: 'claude' as const,
      project_path: null,
      file_refs: [],
      confidence: 0.6,
      created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(),
      stale_score: 0,
      access_count: 0,
      last_accessed: null,
      metadata: {},
    };

    await store.add('personal', unit);
    const results = await store.search('personal', vector, 5);
    const result = results[0];

    // v2 fields should have sensible defaults
    expect(result.evidence_score).toBe(0.5);
    expect(result.corroborations).toBe(0);
    expect(result.contradiction_refs).toEqual([]);
    expect(result.sensitivity).toBe('internal');
    expect(result.entity_links).toEqual([]);
    expect(result.propagation_path).toEqual([]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/lib/cortex/store.test.ts`

- [ ] **Step 4: Evolve the Arrow schema**

In `src/lib/cortex/store.ts`, add new Arrow fields to the schema builder function. These are all nullable Utf8 fields (JSON-serialized for complex types) or nullable Float64/Int32 for numbers:

```typescript
// Add after existing fields in the schema:
new arrow.Field('scope', new arrow.Utf8(), true),              // JSON: { level, entity_id }
new arrow.Field('entity_links', new arrow.Utf8(), true),       // JSON array
new arrow.Field('evidence_score', new arrow.Float64(), true),  // nullable
new arrow.Field('corroborations', new arrow.Int32(), true),    // nullable
new arrow.Field('contradiction_refs', new arrow.Utf8(), true), // JSON array
new arrow.Field('sensitivity', new arrow.Utf8(), true),        // nullable
new arrow.Field('creator_scope', new arrow.Utf8(), true),      // JSON or null
new arrow.Field('origin', new arrow.Utf8(), true),             // JSON or null
new arrow.Field('propagation_path', new arrow.Utf8(), true),   // JSON array
```

In the `add()` method, after opening/creating the table but before `table.add([record])`, call migration:
```typescript
import { migrateTableToV2 } from './store-migration';

// In add(), after getting/creating the table:
await migrateTableToV2(table);
```

Also call `migrateTableToV2` in `search()` and `browse()` after getting the table, to ensure reads from v1 tables also get the new columns. Cache a Set of already-migrated table paths to avoid repeated migration checks.

Update the serialization (unitToRecord) to include v2 fields:
```typescript
scope: unit.scope ? JSON.stringify(unit.scope) : null,
entity_links: JSON.stringify(unit.entity_links ?? []),
evidence_score: unit.evidence_score ?? 0.5,
corroborations: unit.corroborations ?? 0,
contradiction_refs: JSON.stringify(unit.contradiction_refs ?? []),
sensitivity: unit.sensitivity ?? 'internal',
creator_scope: unit.creator_scope ? JSON.stringify(unit.creator_scope) : null,
origin: unit.origin ? JSON.stringify(unit.origin) : null,
propagation_path: JSON.stringify(unit.propagation_path ?? []),
```

**CRITICAL: Also update `updateAccessCount()`** — this method uses a delete+re-add pattern that reconstructs the record from raw fields. It must include all v2 fields in the reconstruction to avoid dropping them:

```typescript
// In updateAccessCount(), when reconstructing the record, add:
scope: raw.scope ?? null,
entity_links: raw.entity_links ?? '[]',
evidence_score: raw.evidence_score ?? 0.5,
corroborations: raw.corroborations ?? 0,
contradiction_refs: raw.contradiction_refs ?? '[]',
sensitivity: raw.sensitivity ?? 'internal',
creator_scope: raw.creator_scope ?? null,
origin: raw.origin ?? null,
propagation_path: raw.propagation_path ?? '[]',
```

**Also update `browse()` deserialization** — `browse()` has its own row-mapping logic separate from `search()`. Apply the same v2 field parsing to `browse()` results.

Update deserialization in BOTH `search()` and `browse()` to parse v2 fields with defaults:
```typescript
scope: row.scope ? JSON.parse(row.scope) : undefined,
entity_links: JSON.parse(row.entity_links || '[]'),
evidence_score: row.evidence_score ?? 0.5,
corroborations: row.corroborations ?? 0,
contradiction_refs: JSON.parse(row.contradiction_refs || '[]'),
sensitivity: row.sensitivity || 'internal',
creator_scope: row.creator_scope ? JSON.parse(row.creator_scope) : null,
origin: row.origin ? JSON.parse(row.origin) : undefined,
propagation_path: JSON.parse(row.propagation_path || '[]'),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/store.test.ts`
Expected: All tests pass (existing + 2 new)

- [ ] **Step 6: Commit**

```bash
git add src/lib/cortex/store.ts tests/lib/cortex/store.test.ts
git commit -m "feat(cortex): evolve LanceDB schema with v2 knowledge unit fields"
```

---

### Task 5: Update search and scoring for v2

**Files:**
- Modify: `src/lib/cortex/retrieval/scoring.ts`
- Modify: `src/lib/cortex/retrieval/search.ts`
- Modify: `tests/lib/cortex/retrieval/search.test.ts`

- [ ] **Step 1: Read current search.ts and scoring.ts**

Read both files to understand the current scoring formula and search layer iteration.

- [ ] **Step 2: Write a failing test for evidence-aware scoring**

Add to `tests/lib/cortex/retrieval/scoring.test.ts` (or the existing scoring test file):

```typescript
import { computeRelevanceScore } from '@/lib/cortex/retrieval/scoring';

it('uses evidence_score when provided instead of confidence', () => {
  const withConfidenceOnly = computeRelevanceScore({
    similarity: 0.9, confidence: 0.8, stale_score: 0, created: new Date().toISOString(),
  });
  const withHighEvidence = computeRelevanceScore({
    similarity: 0.9, confidence: 0.8, stale_score: 0, created: new Date().toISOString(),
    evidence_score: 0.95,
  });
  const withLowEvidence = computeRelevanceScore({
    similarity: 0.9, confidence: 0.8, stale_score: 0, created: new Date().toISOString(),
    evidence_score: 0.3,
  });

  // evidence_score should override confidence in the formula
  expect(withHighEvidence).toBeGreaterThan(withConfidenceOnly);
  expect(withLowEvidence).toBeLessThan(withConfidenceOnly);
});

it('falls back to confidence when evidence_score is undefined', () => {
  const result = computeRelevanceScore({
    similarity: 0.9, confidence: 0.8, stale_score: 0, created: new Date().toISOString(),
  });
  // Should use confidence (0.8) as the evidence factor
  expect(result).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Update scoring.ts to incorporate evidence_score**

Add `evidence_score` as an optional parameter to `computeRelevanceScore`:

```typescript
export function computeRelevanceScore(params: {
  similarity: number;
  confidence: number;
  stale_score: number;
  created: string;
  evidence_score?: number;  // NEW: v2 evidence score
}): number {
  const recencyBoost = computeRecencyBoost(params.created);
  const evidence = params.evidence_score ?? params.confidence;  // fallback to confidence for v1 data
  return Math.min(1.0, params.similarity * evidence * (1 - params.stale_score) * recencyBoost);
}
```

- [ ] **Step 4: Update search.ts to pass evidence_score in ALL scoring calls**

In the search method, pass `evidence_score` in BOTH the initial scoring AND the staleness recomputation:

```typescript
// Initial scoring (in the per-layer loop):
const relevance = computeRelevanceScore({
  similarity,
  confidence: unit.confidence,
  stale_score: unit.stale_score,
  created: unit.created,
  evidence_score: unit.evidence_score,  // NEW
}) * weight;
```

Also find the staleness recomputation block (where `computeStaleness` results are used to re-score) and pass `evidence_score` there too:
```typescript
// After staleness recomputation:
r.relevance_score = computeRelevanceScore({
  similarity: r.similarity,
  confidence: r.confidence,
  stale_score: r.stale_score,
  created: r.created,
  evidence_score: r.evidence_score,  // NEW — must be here too
}) * (LAYER_WEIGHTS[r.layer] ?? 0.5);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/retrieval/`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/cortex/retrieval/scoring.ts src/lib/cortex/retrieval/search.ts tests/lib/cortex/retrieval/search.test.ts
git commit -m "feat(cortex): incorporate evidence_score into retrieval scoring"
```

---

## Chunk 3: API Backward Compatibility

### Task 6: Update knowledge API to accept both layer and scope

**Files:**
- Modify: `src/app/api/cortex/knowledge/route.ts`

- [ ] **Step 1: Read current knowledge/route.ts**

- [ ] **Step 2: Update POST handler to accept both formats**

The POST handler currently requires `layer`. Update it to:
1. Accept `scope` as an alternative to `layer`
2. If `scope` is provided, use it directly and derive `layer` for backward compat
3. If only `layer` is provided, derive `scope` from it
4. Accept new v2 fields: `sensitivity`, `origin`, `entity_links`

```typescript
// In POST handler, after parsing body:
const { text, type, workspace_id } = body;
let { layer, scope, sensitivity, origin, entity_links } = body;

// Validate: need either layer or scope
if (!text || !type) {
  return NextResponse.json({ error: 'text and type are required' }, { status: 400 });
}

if (!layer && !scope) {
  return NextResponse.json({ error: 'layer or scope is required' }, { status: 400 });
}

// Resolve layer ↔ scope
if (scope && !layer) {
  layer = scopeToLayer(scope);
} else if (layer && !scope) {
  scope = layerToScope(layer, workspace_id);
}

// Compute layerKey from scope (or fallback to old method)
const layerKey = scope
  ? scopeToLayerKey(scope, workspace_id)
  : (layer === 'workspace' && workspace_id ? `workspace/${workspace_id}` : layer);
```

Import the compat functions:
```typescript
import { layerToScope, scopeToLayer, scopeToLayerKey } from '@/lib/cortex/knowledge/compat';
```

Add v2 fields to the unit construction. Use `getConfidenceBase(type)` for initial evidence_score (not a flat 0.5 — per spec, evidence starts from the type's base confidence). Derive `creator_entity_id` from the authenticated user:

```typescript
import { getConfidenceBase } from '@/lib/cortex/knowledge/types';

// In unit construction:
scope,
entity_links: entity_links ?? [],
evidence_score: getConfidenceBase(type),  // NOT 0.5 — matches spec
corroborations: 0,
contradiction_refs: [],
sensitivity: sensitivity ?? 'internal',
creator_scope: null,
origin: origin ?? { source_type: 'manual', source_ref: '', creator_entity_id: `person-${user}` },
propagation_path: [],
```

Note: `user` is already available from `getAuthUser(request)` at the top of the handler.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cortex/knowledge/route.ts
git commit -m "feat(cortex): accept both layer and scope in knowledge API"
```

---

### Task 7: Update MCP tools to accept both layer and scope

**Files:**
- Modify: `src/lib/cortex/mcp/server.ts`

- [ ] **Step 1: Read current mcp/server.ts**

Read the `cortex_teach` tool schema and handler to understand what fields are accepted.

- [ ] **Step 2: Update cortex_teach tool**

1. Add `scope` as an optional property in the tool's input schema (alongside existing `layer`)
2. In the handler, apply the same layer↔scope resolution logic from Task 6
3. Add `sensitivity` and `origin` as optional properties
4. Include v2 fields in the unit construction, using `getConfidenceBase(type)` for evidence_score (not 0.5)
5. Derive `creator_entity_id` from the agent context (use `'person-default-user'` as placeholder since MCP tools don't have user auth context — the real entity ID will be resolved by Pillar 5)

The key change: `layer` remains supported but `scope` is preferred. If both are provided, `scope` wins.

Import compat functions:
```typescript
import { layerToScope, scopeToLayer, scopeToLayerKey } from '../knowledge/compat';
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/cortex/mcp/server.ts
git commit -m "feat(cortex): accept both layer and scope in MCP cortex_teach tool"
```

---

### Task 8: Update learn hook for v2 compatibility

**Files:**
- Modify: `bin/cortex-learn-hook.js`

- [ ] **Step 1: Read current cortex-learn-hook.js**

- [ ] **Step 2: Add scope field alongside layer**

The hook currently POSTs `{ text, type, layer: 'personal' }`. Update both entries to also include:

```javascript
const scope = JSON.stringify({ level: 'personal', entity_id: 'person-default-user' });

// Question entry:
const questionEntry = JSON.stringify({
  text: lastExchange.question,
  type: 'context',
  layer: 'personal',
  scope: { level: 'personal', entity_id: 'person-default-user' },
  origin: { source_type: 'conversation', source_ref: sessionId || '', creator_entity_id: 'person-default-user' },
});

// Answer entry:
const answerEntry = JSON.stringify({
  text: `Q: ${lastExchange.question}\nA: ${condensedAnswer}`,
  type: knowledgeType,
  layer: 'personal',
  scope: { level: 'personal', entity_id: 'person-default-user' },
  origin: { source_type: 'conversation', source_ref: sessionId || '', creator_entity_id: 'person-default-user' },
});
```

Note: `sessionId` should be extracted from the input JSON if available (the hook receives `{ transcript_path }` — the session ID is the filename without extension).

- [ ] **Step 3: Commit**

```bash
git add bin/cortex-learn-hook.js
git commit -m "feat(cortex): add scope and origin to learn hook knowledge entries"
```

---

## Chunk 4: Pipeline Integration and Final Tests

### Task 9: Update ingestion pipeline for v2 fields

**Files:**
- Modify: `src/lib/cortex/ingestion/pipeline.ts`
- Modify: `src/lib/cortex/ingestion/chunker.ts`

- [ ] **Step 1: Read pipeline.ts and chunker.ts**

- [ ] **Step 2: Update RawChunk → KnowledgeUnit mapping in pipeline**

In the pipeline where KnowledgeUnit is constructed from RawChunk, add v2 fields with defaults:

```typescript
const unit: KnowledgeUnit = {
  // ... existing v1 fields ...
  // v2 fields with defaults
  scope: layerToScope(chunk.layer, chunk.workspace_id),
  entity_links: [],
  evidence_score: getConfidenceBase(chunk.type),  // start with base confidence
  corroborations: 0,
  contradiction_refs: [],
  sensitivity: 'internal',
  creator_scope: null,
  origin: {
    source_type: 'conversation',
    source_ref: chunk.session_id ?? '',
    creator_entity_id: 'person-default-user',
  },
  propagation_path: [],
};
```

Import the compat function:
```typescript
import { layerToScope } from '../knowledge/compat';
```

- [ ] **Step 3: Run the full cortex test suite**

Run: `npx vitest run tests/lib/cortex/`
Expected: All tests pass (including existing pipeline tests)

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/ingestion/pipeline.ts
git commit -m "feat(cortex): add v2 fields to ingestion pipeline output"
```

---

### Task 10: Export knowledge/compat and evidence from knowledge index

**Files:**
- Modify or create: `src/lib/cortex/knowledge/index.ts` (if a barrel exists, update it; if not, create one)

- [ ] **Step 1: Check if knowledge/index.ts exists**

Read `src/lib/cortex/knowledge/` directory to see if there's a barrel export.

- [ ] **Step 2: Create or update barrel export**

Ensure these are re-exported:
```typescript
export { layerToScope, scopeToLayer, scopeToLayerKey, layerKeyToScope } from './compat';
export { computeEvidenceScore, AUTHORITY_FACTORS } from './evidence';
export type { EvidenceScoreInput } from './evidence';
// Existing type exports from types.ts should already be accessible
```

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run tests/lib/cortex/`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/knowledge/
git commit -m "feat(cortex): export compat and evidence modules from knowledge barrel"
```

---

## Summary

| Task | Component | Tests | Status |
|------|-----------|-------|--------|
| 1 | v2 type definitions | — | |
| 2 | v1↔v2 compatibility layer | 10 | |
| 3 | Evidence score computation | 8 | |
| 4 | Arrow schema evolution | 2 | |
| 5 | Search/scoring update | 2 | |
| 6 | Knowledge API backward compat | — | |
| 7 | MCP tool backward compat | — | |
| 8 | Learn hook v2 fields | — | |
| 9 | Pipeline v2 integration | regression | |
| 10 | Barrel export | regression | |

**Total: 10 tasks, ~22 new tests, 4 chunks**

**Key design decisions:**
- `layer` field is KEPT on KnowledgeUnit for backward compat (intentional spec deviation — spec says "removed" but we keep it as derived field)
- v2 fields are all optional/nullable — existing LanceDB tables migrated in-place via `addColumns()` during `store.init()`
- `updateAccessCount()` and `browse()` updated to preserve/parse v2 fields
- API accepts both `layer` and `scope` params — `scope` takes precedence
- Evidence score starts at `base_confidence` and evolves with access/corroboration (computed by Pillar 6: Gravity)

After this plan is complete, both the Entity Graph (Pillar 1) and Knowledge Unit Evolution (Pillar 2) will be in place — enabling Pillar 3 (Context Assembly Engine) and Pillar 4 (Boundary Engine) to build on them.
