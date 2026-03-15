# Cortex v2 — Pillar 3: Context Assembly Engine

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat layer-iteration search with a 6-stage context assembly pipeline that detects intent, resolves entities, computes graph-aware weights, searches multiple scopes in parallel, fuses results with evidence scoring, and surfaces conflicts — all within 150ms.

**Architecture:** A new `ContextEngine` class wraps the existing `CortexStore` (for low-level vector search) and `EntityGraph` (for graph distance/proximity). It does NOT replace `CortexSearch` — instead it provides the higher-level retrieval interface that the RAG hook calls. The existing `CortexSearch` remains for backward-compatible simple searches. The RAG hook (`cortex-hook.js`) switches from calling the search API to calling a new context-assembly API endpoint.

**Tech Stack:** TypeScript, vitest, LanceDB, SQLite (entity graph)

**Spec:** `docs/superpowers/specs/2026-03-14-cortex-v2-design.md` — Pillar 3

**Depends on:** Pillar 1 (Entity Graph) + Pillar 2 (Knowledge Unit Evolution) — both completed

---

## File Structure

```
New files:
├── src/lib/cortex/retrieval/intent.ts         — Intent detection (regex + keyword)
├── src/lib/cortex/retrieval/weight.ts          — Weight computation (graph × intent × freshness × authority)
├── src/lib/cortex/retrieval/conflict.ts        — Conflict detection in results
├── src/lib/cortex/retrieval/formatter.ts       — Context formatting for RAG injection
├── src/lib/cortex/retrieval/context-engine.ts  — Main 6-stage ContextEngine class
├── src/app/api/cortex/context/route.ts         — API endpoint for context assembly

Modified files:
├── bin/cortex-hook.js                          — Switch to context-assembly endpoint

Test files:
├── tests/lib/cortex/retrieval/intent.test.ts
├── tests/lib/cortex/retrieval/weight.test.ts
├── tests/lib/cortex/retrieval/conflict.test.ts
├── tests/lib/cortex/retrieval/formatter.test.ts
├── tests/lib/cortex/retrieval/context-engine.test.ts
```

---

## Chunk 1: Intent Detection and Weight Computation

### Task 1: Intent detection

**Files:**
- Create: `src/lib/cortex/retrieval/intent.ts`
- Create: `tests/lib/cortex/retrieval/intent.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/retrieval/intent.test.ts
import { describe, it, expect } from 'vitest';
import { detectIntent, INTENTS } from '@/lib/cortex/retrieval/intent';
import type { IntentResult } from '@/lib/cortex/retrieval/intent';

describe('detectIntent', () => {
  it('detects debugging intent', () => {
    const result = detectIntent('why does the auth service throw a timeout error?');
    expect(result.intent).toBe('debugging');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('detects architecture intent', () => {
    const result = detectIntent('what architecture pattern should we use for the new service?');
    expect(result.intent).toBe('architecture');
  });

  it('detects how-to intent', () => {
    const result = detectIntent('how do I deploy this service to production?');
    expect(result.intent).toBe('how-to');
  });

  it('detects security intent', () => {
    const result = detectIntent('is there a vulnerability in our authentication flow?');
    expect(result.intent).toBe('security');
  });

  it('defaults to general for ambiguous queries', () => {
    const result = detectIntent('tell me about the project');
    expect(result.intent).toBe('general');
  });

  it('returns bias config for the detected intent', () => {
    const result = detectIntent('fix this bug in the login page');
    expect(result.biases).toBeDefined();
    expect(result.biases.scope_boost).toBeDefined();
    expect(result.biases.type_boost).toBeDefined();
  });

  it('exports all intent definitions', () => {
    expect(Object.keys(INTENTS)).toContain('debugging');
    expect(Object.keys(INTENTS)).toContain('architecture');
    expect(Object.keys(INTENTS)).toContain('general');
    expect(Object.keys(INTENTS).length).toBe(8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/cortex/retrieval/intent.test.ts`

- [ ] **Step 3: Implement intent detection**

```typescript
// src/lib/cortex/retrieval/intent.ts

export interface IntentBiases {
  scope_boost: Record<string, number>;  // scope level → multiplier
  type_boost: Record<string, number>;   // knowledge type → multiplier
  recency_boost: number;                // extra recency multiplier
}

export interface IntentResult {
  intent: string;
  confidence: number;
  biases: IntentBiases;
}

interface IntentDef {
  patterns: RegExp[];
  keywords: string[];
  biases: IntentBiases;
}

export const INTENTS: Record<string, IntentDef> = {
  debugging: {
    patterns: [
      /\b(error|bug|fix|crash|fail|broken|throw|exception|timeout|issue)\b/i,
      /\bwhy\s+(does|is|did|do)\b/i,
      /\bnot\s+work/i,
    ],
    keywords: ['error', 'bug', 'fix', 'debug', 'crash', 'fail', 'broken', 'throw', 'exception', 'timeout', 'issue', 'stack trace'],
    biases: {
      scope_boost: { personal: 1.2, team: 1.0, department: 0.9, organization: 0.8 },
      type_boost: { error_fix: 1.3, pattern: 1.0, decision: 0.8, conversation: 0.7 },
      recency_boost: 1.1,
    },
  },
  architecture: {
    patterns: [
      /\b(architect|design|pattern|structure|approach)\b/i,
      /\bshould\s+we\s+(use|adopt|switch|migrate)\b/i,
    ],
    keywords: ['architecture', 'design', 'pattern', 'structure', 'approach', 'decision', 'migration', 'refactor'],
    biases: {
      scope_boost: { personal: 0.9, team: 1.1, department: 1.2, organization: 1.0 },
      type_boost: { decision: 1.5, pattern: 1.2, error_fix: 0.7, conversation: 0.5 },
      recency_boost: 1.0,
    },
  },
  onboarding: {
    patterns: [
      /\b(how\s+does|explain|what\s+is|overview|getting\s+started)\b/i,
      /\bnew\s+to\b/i,
    ],
    keywords: ['explain', 'overview', 'introduction', 'getting started', 'onboarding', 'how does'],
    biases: {
      scope_boost: { personal: 0.7, team: 1.0, department: 1.1, organization: 1.2 },
      type_boost: { pattern: 1.3, decision: 1.2, summary: 1.2, conversation: 0.5 },
      recency_boost: 0.9,
    },
  },
  policy: {
    patterns: [
      /\b(policy|compliance|regulation|standard|rule|requirement)\b/i,
      /\ballowed\s+to\b/i,
    ],
    keywords: ['policy', 'compliance', 'standard', 'regulation', 'rule', 'requirement', 'allowed'],
    biases: {
      scope_boost: { personal: 0.6, team: 0.8, department: 1.0, organization: 1.3 },
      type_boost: { decision: 1.5, preference: 1.2, pattern: 0.8, conversation: 0.3 },
      recency_boost: 1.0,
    },
  },
  'how-to': {
    patterns: [
      /\bhow\s+(do|can|to|should)\s+I?\b/i,
      /\bsteps?\s+(to|for)\b/i,
      /\bwhat('s| is)\s+the\s+(command|way|process)\b/i,
    ],
    keywords: ['how to', 'steps', 'command', 'run', 'deploy', 'install', 'configure', 'setup'],
    biases: {
      scope_boost: { personal: 1.2, team: 1.0, department: 0.8, organization: 0.7 },
      type_boost: { command: 1.3, pattern: 1.2, error_fix: 1.0, conversation: 0.6 },
      recency_boost: 1.05,
    },
  },
  review: {
    patterns: [
      /\b(review|feedback|improve|quality|best\s+practice)\b/i,
      /\bis\s+this\s+(good|correct|right)\b/i,
    ],
    keywords: ['review', 'feedback', 'quality', 'improve', 'best practice', 'convention'],
    biases: {
      scope_boost: { personal: 0.9, team: 1.2, department: 1.0, organization: 0.8 },
      type_boost: { preference: 1.3, pattern: 1.2, code_pattern: 1.2, decision: 1.0 },
      recency_boost: 1.0,
    },
  },
  security: {
    patterns: [
      /\b(security|vulnerab|exploit|attack|auth|cve|injection|xss)\b/i,
      /\bsecure\b/i,
    ],
    keywords: ['security', 'vulnerability', 'exploit', 'attack', 'authentication', 'authorization', 'cve', 'injection', 'xss', 'csrf'],
    biases: {
      scope_boost: { personal: 0.8, team: 1.0, department: 1.2, organization: 1.0 },
      type_boost: { error_fix: 1.3, decision: 1.2, pattern: 1.0, conversation: 0.5 },
      recency_boost: 1.1,
    },
  },
  general: {
    patterns: [],
    keywords: [],
    biases: {
      scope_boost: { personal: 1.0, team: 1.0, department: 1.0, organization: 1.0 },
      type_boost: {},
      recency_boost: 1.0,
    },
  },
};

/**
 * Detect the intent of a query using regex patterns and keyword scoring.
 * No LLM call — fast and deterministic.
 */
export function detectIntent(query: string): IntentResult {
  const lower = query.toLowerCase();
  let bestIntent = 'general';
  let bestScore = 0;

  for (const [name, def] of Object.entries(INTENTS)) {
    if (name === 'general') continue;

    let score = 0;

    // Regex pattern matches (high weight)
    for (const pattern of def.patterns) {
      if (pattern.test(query)) score += 2;
    }

    // Keyword matches (lower weight)
    for (const keyword of def.keywords) {
      if (lower.includes(keyword)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIntent = name;
    }
  }

  return {
    intent: bestIntent,
    confidence: bestScore > 0 ? Math.min(1.0, bestScore / 6) : 0.5,
    biases: INTENTS[bestIntent].biases,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/retrieval/intent.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/retrieval/intent.ts tests/lib/cortex/retrieval/intent.test.ts
git commit -m "feat(cortex): add intent detection for context assembly"
```

---

### Task 2: Weight computation

**Files:**
- Create: `src/lib/cortex/retrieval/weight.ts`
- Create: `tests/lib/cortex/retrieval/weight.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/retrieval/weight.test.ts
import { describe, it, expect } from 'vitest';
import { computeScopeWeight } from '@/lib/cortex/retrieval/weight';
import type { IntentBiases } from '@/lib/cortex/retrieval/intent';

describe('computeScopeWeight', () => {
  const neutralBiases: IntentBiases = {
    scope_boost: { personal: 1.0, team: 1.0, department: 1.0, organization: 1.0 },
    type_boost: {},
    recency_boost: 1.0,
  };

  it('returns 1.0 for self (distance 0)', () => {
    const weight = computeScopeWeight({
      graphProximity: 1.0,  // 1/(1+0)
      scopeLevel: 'personal',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    expect(weight).toBeCloseTo(1.0);
  });

  it('decreases with graph distance', () => {
    const close = computeScopeWeight({
      graphProximity: 0.5,  // distance 1
      scopeLevel: 'team',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    const far = computeScopeWeight({
      graphProximity: 0.25,  // distance 3
      scopeLevel: 'organization',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    expect(close).toBeGreaterThan(far);
  });

  it('is boosted by intent biases', () => {
    const debugBiases: IntentBiases = {
      scope_boost: { personal: 1.2, team: 0.8 },
      type_boost: {},
      recency_boost: 1.0,
    };
    const personal = computeScopeWeight({
      graphProximity: 0.5,
      scopeLevel: 'personal',
      intentBiases: debugBiases,
      authorityFactor: 1.0,
    });
    const team = computeScopeWeight({
      graphProximity: 0.5,
      scopeLevel: 'team',
      intentBiases: debugBiases,
      authorityFactor: 1.0,
    });
    expect(personal).toBeGreaterThan(team);
  });

  it('is boosted by authority factor', () => {
    const low = computeScopeWeight({
      graphProximity: 0.5,
      scopeLevel: 'team',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    const high = computeScopeWeight({
      graphProximity: 0.5,
      scopeLevel: 'team',
      intentBiases: neutralBiases,
      authorityFactor: 1.2,
    });
    expect(high).toBeGreaterThan(low);
  });

  it('never returns negative', () => {
    const weight = computeScopeWeight({
      graphProximity: 0,
      scopeLevel: 'organization',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    expect(weight).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/cortex/retrieval/weight.test.ts`

- [ ] **Step 3: Implement weight computation**

```typescript
// src/lib/cortex/retrieval/weight.ts
import type { IntentBiases } from './intent';
import type { ScopeLevel } from '../knowledge/types';

export interface ScopeWeightInput {
  graphProximity: number;    // 0-1, from EntityGraph.proximity()
  scopeLevel: ScopeLevel | string;
  intentBiases: IntentBiases;
  authorityFactor: number;   // 1.0 default, higher for experts/docs
}

/**
 * Compute the retrieval weight for a knowledge scope.
 *
 * weight = graphProximity × intentBias × authorityFactor
 *
 * Per spec: weight(scope) = graph_proximity × intent_bias × freshness_bonus × authority
 * Freshness is applied per-result in the fusion stage, not per-scope.
 */
export function computeScopeWeight(input: ScopeWeightInput): number {
  const { graphProximity, scopeLevel, intentBiases, authorityFactor } = input;

  const intentBias = intentBiases.scope_boost[scopeLevel] ?? 1.0;

  return Math.max(0, graphProximity * intentBias * authorityFactor);
}

/**
 * Compute per-result type boost from intent biases.
 */
export function computeTypeBoost(knowledgeType: string, intentBiases: IntentBiases): number {
  return intentBiases.type_boost[knowledgeType] ?? 1.0;
}

/**
 * Authority factor for a source based on role and expertise.
 *
 * role_boost: 0.0 member, 0.1 lead, 0.15 senior/principal, 0.2 director+
 * expertise_weight: EXPERT_IN edge weight (0-1)
 * Documents get 1.2 base authority.
 */
export function computeAuthority(params: {
  role?: string;
  expertiseWeight?: number;
  isDocument?: boolean;
}): number {
  const { role, expertiseWeight = 0, isDocument = false } = params;

  if (isDocument) return 1.2;

  const roleBoosts: Record<string, number> = {
    member: 0.0,
    lead: 0.1,
    senior: 0.15,
    principal: 0.15,
    director: 0.2,
    vp: 0.2,
    cto: 0.2,
  };

  const roleBoost = roleBoosts[role?.toLowerCase() ?? 'member'] ?? 0.0;
  return Math.max(1.0, roleBoost + expertiseWeight);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/retrieval/weight.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cortex/retrieval/weight.ts tests/lib/cortex/retrieval/weight.test.ts
git commit -m "feat(cortex): add scope weight computation for context assembly"
```

---

## Chunk 2: Conflict Detection and Context Formatting

### Task 3: Conflict detection

**Files:**
- Create: `src/lib/cortex/retrieval/conflict.ts`
- Create: `tests/lib/cortex/retrieval/conflict.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/retrieval/conflict.test.ts
import { describe, it, expect } from 'vitest';
import { detectConflicts } from '@/lib/cortex/retrieval/conflict';
import type { ScoredKnowledge } from '@/lib/cortex/knowledge/types';

function makeResult(overrides: Partial<ScoredKnowledge> = {}): ScoredKnowledge {
  return {
    id: 'r1', vector: [], text: 'test', type: 'decision', layer: 'personal',
    workspace_id: null, session_id: null, agent_type: 'claude',
    project_path: null, file_refs: [], confidence: 0.8,
    created: new Date().toISOString(), source_timestamp: new Date().toISOString(),
    stale_score: 0, access_count: 0, last_accessed: null, metadata: {},
    relevance_score: 0.9, similarity: 0.9,
    contradiction_refs: [], ...overrides,
  };
}

describe('detectConflicts', () => {
  it('returns no conflicts when no contradiction_refs', () => {
    const results = [makeResult({ id: 'a' }), makeResult({ id: 'b' })];
    const conflicts = detectConflicts(results);
    expect(conflicts).toHaveLength(0);
  });

  it('detects conflict between two results', () => {
    const results = [
      makeResult({ id: 'a', text: 'use pool size 50', contradiction_refs: ['b'] }),
      makeResult({ id: 'b', text: 'scale horizontally', contradiction_refs: ['a'] }),
    ];
    const conflicts = detectConflicts(results);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unitA.id).toBe('a');
    expect(conflicts[0].unitB.id).toBe('b');
  });

  it('ignores contradiction_refs pointing to results not in the set', () => {
    const results = [
      makeResult({ id: 'a', contradiction_refs: ['z'] }),  // z is not in results
    ];
    const conflicts = detectConflicts(results);
    expect(conflicts).toHaveLength(0);
  });

  it('deduplicates symmetric conflicts', () => {
    // A contradicts B and B contradicts A should produce one conflict, not two
    const results = [
      makeResult({ id: 'a', contradiction_refs: ['b'] }),
      makeResult({ id: 'b', contradiction_refs: ['a'] }),
    ];
    const conflicts = detectConflicts(results);
    expect(conflicts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement conflict detection**

```typescript
// src/lib/cortex/retrieval/conflict.ts
import type { ScoredKnowledge } from '../knowledge/types';

export interface ConflictPair {
  unitA: ScoredKnowledge;
  unitB: ScoredKnowledge;
}

/**
 * Detect conflicts among search results by checking contradiction_refs.
 * Returns deduplicated conflict pairs (A↔B counted once, not twice).
 */
export function detectConflicts(results: ScoredKnowledge[]): ConflictPair[] {
  const resultMap = new Map(results.map(r => [r.id, r]));
  const seen = new Set<string>();
  const conflicts: ConflictPair[] = [];

  for (const result of results) {
    const refs = result.contradiction_refs ?? [];
    for (const refId of refs) {
      const other = resultMap.get(refId);
      if (!other) continue;

      const key = [result.id, refId].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);

      conflicts.push({ unitA: result, unitB: other });
    }
  }

  return conflicts;
}
```

- [ ] **Step 3: Run tests, commit**

Run: `npx vitest run tests/lib/cortex/retrieval/conflict.test.ts`

```bash
git add src/lib/cortex/retrieval/conflict.ts tests/lib/cortex/retrieval/conflict.test.ts
git commit -m "feat(cortex): add conflict detection for search results"
```

---

### Task 4: Context formatter

**Files:**
- Create: `src/lib/cortex/retrieval/formatter.ts`
- Create: `tests/lib/cortex/retrieval/formatter.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/retrieval/formatter.test.ts
import { describe, it, expect } from 'vitest';
import { formatContext } from '@/lib/cortex/retrieval/formatter';
import type { ScoredKnowledge } from '@/lib/cortex/knowledge/types';
import type { ConflictPair } from '@/lib/cortex/retrieval/conflict';

function makeResult(overrides: Partial<ScoredKnowledge> = {}): ScoredKnowledge {
  return {
    id: 'r1', vector: [], text: 'test knowledge', type: 'decision', layer: 'personal',
    workspace_id: null, session_id: null, agent_type: 'claude',
    project_path: null, file_refs: [], confidence: 0.8,
    created: '2026-03-15T00:00:00.000Z', source_timestamp: '2026-03-15T00:00:00.000Z',
    stale_score: 0, access_count: 5, last_accessed: null, metadata: {},
    relevance_score: 0.9, similarity: 0.9,
    ...overrides,
  };
}

describe('formatContext', () => {
  it('wraps results in cortex-context tags', () => {
    const output = formatContext([makeResult()], []);
    expect(output).toContain('<cortex-context>');
    expect(output).toContain('</cortex-context>');
  });

  it('includes type labels and dates', () => {
    const output = formatContext([makeResult({ type: 'error_fix', source_timestamp: '2026-03-10T00:00:00.000Z' })], []);
    expect(output).toContain('[Error Fix]');
    expect(output).toContain('2026-03-10');
  });

  it('includes source attribution when origin is present', () => {
    const output = formatContext([makeResult({
      origin: { source_type: 'conversation', source_ref: 'sess-1', creator_entity_id: 'person-alice' },
    })], []);
    expect(output).toContain('person-alice');
  });

  it('includes conflict callout when conflicts exist', () => {
    const a = makeResult({ id: 'a', text: 'use pool size 50' });
    const b = makeResult({ id: 'b', text: 'scale horizontally' });
    const conflicts: ConflictPair[] = [{ unitA: a, unitB: b }];
    const output = formatContext([a, b], conflicts);
    expect(output).toContain('Conflicting');
  });

  it('respects max token budget', () => {
    const bigResults = Array.from({ length: 20 }, (_, i) =>
      makeResult({ id: `r${i}`, text: 'x'.repeat(500) })
    );
    const output = formatContext(bigResults, [], { maxTokens: 500 });
    // Should not include all 20 results (would be ~2500 tokens)
    expect(output.length).toBeLessThan(3000);
  });

  it('returns empty string when no results', () => {
    expect(formatContext([], [])).toBe('');
  });
});
```

- [ ] **Step 2: Implement context formatter**

```typescript
// src/lib/cortex/retrieval/formatter.ts
import type { ScoredKnowledge } from '../knowledge/types';
import type { ConflictPair } from './conflict';

const TYPE_LABELS: Record<string, string> = {
  decision: 'Decision', pattern: 'Pattern', preference: 'Preference',
  error_fix: 'Error Fix', context: 'Context', code_pattern: 'Code',
  command: 'Command', conversation: 'Conversation', summary: 'Summary',
};

export interface FormatOptions {
  maxTokens?: number;
}

/**
 * Format search results + conflicts as annotated <cortex-context> for RAG injection.
 */
export function formatContext(
  results: ScoredKnowledge[],
  conflicts: ConflictPair[],
  options: FormatOptions = {},
): string {
  if (results.length === 0) return '';

  const maxTokens = options.maxTokens ?? 1500;
  const entries: string[] = [];
  let tokens = 20;  // overhead for tags

  // Format each result with attribution
  for (const unit of results) {
    const label = TYPE_LABELS[unit.type] || unit.type;
    const date = (unit.source_timestamp || '').slice(0, 10);
    const creator = unit.origin?.creator_entity_id ?? '';
    const sourceInfo = creator ? ` (${creator})` : '';

    let entry = `[${label}] ${date}${sourceInfo}:\n  ${unit.text}`;

    const entryTokens = Math.ceil(entry.length / 4);
    if (tokens + entryTokens > maxTokens) break;

    entries.push(entry);
    tokens += entryTokens;
  }

  if (entries.length === 0) return '';

  // Build conflict section
  let conflictSection = '';
  if (conflicts.length > 0) {
    const conflictLines = conflicts.map(c =>
      `  - "${c.unitA.text.slice(0, 80)}..." vs "${c.unitB.text.slice(0, 80)}..."`
    );
    conflictSection = `\nConflicting perspectives (${conflicts.length}):\n${conflictLines.join('\n')}\n`;
  }

  const sourceCount = entries.length;
  const header = `Relevant knowledge (${sourceCount} source${sourceCount > 1 ? 's' : ''}${conflicts.length > 0 ? `, ${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}` : ''}):`;

  return [
    '<cortex-context>',
    header,
    '',
    ...entries,
    conflictSection,
    '</cortex-context>',
  ].join('\n');
}
```

- [ ] **Step 3: Run tests, commit**

Run: `npx vitest run tests/lib/cortex/retrieval/formatter.test.ts`

```bash
git add src/lib/cortex/retrieval/formatter.ts tests/lib/cortex/retrieval/formatter.test.ts
git commit -m "feat(cortex): add context formatter for RAG injection"
```

---

## Chunk 3: Context Assembly Engine

### Task 5: ContextEngine — the 6-stage pipeline

**Files:**
- Create: `src/lib/cortex/retrieval/context-engine.ts`
- Create: `tests/lib/cortex/retrieval/context-engine.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/retrieval/context-engine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextEngine } from '@/lib/cortex/retrieval/context-engine';

// Create mocks for dependencies
const mockStore = {
  search: vi.fn().mockResolvedValue([]),
};

const mockGraph = {
  proximity: vi.fn().mockReturnValue(0.5),
  neighborhood: vi.fn().mockReturnValue([]),
  getEntity: vi.fn().mockReturnValue(null),
};

const mockResolver = {
  extractEntities: vi.fn().mockReturnValue([]),
};

const mockEmbedding = {
  embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  dimensions: 3,
  name: 'mock',
  init: vi.fn(),
};

describe('ContextEngine', () => {
  let engine: ContextEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ContextEngine({
      store: mockStore as any,
      graph: mockGraph as any,
      resolver: mockResolver as any,
      embedding: mockEmbedding as any,
      requesterId: 'person-alice',
    });
  });

  it('returns empty context for empty results', async () => {
    const result = await engine.assemble('some query');
    expect(result.results).toHaveLength(0);
    expect(result.context).toBe('');
  });

  it('calls embedding.embed with the query', async () => {
    await engine.assemble('test query');
    expect(mockEmbedding.embed).toHaveBeenCalledWith(['test query']);
  });

  it('detects intent from the query', async () => {
    const result = await engine.assemble('why does auth throw an error?');
    expect(result.intent.intent).toBe('debugging');
  });

  it('extracts entities from the query', async () => {
    mockResolver.extractEntities.mockReturnValue([
      { entity: { id: 'system-auth', type: 'system', name: 'Auth' }, confidence: 0.9, method: 'alias' },
    ]);
    const result = await engine.assemble('fix the auth service');
    expect(mockResolver.extractEntities).toHaveBeenCalledWith('fix the auth service');
    expect(result.entities).toHaveLength(1);
  });

  it('searches store with embedded query vector', async () => {
    mockStore.search.mockResolvedValue([{
      id: 'k1', text: 'test knowledge', type: 'decision', layer: 'personal',
      confidence: 0.8, stale_score: 0, created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(), evidence_score: 0.7,
      contradiction_refs: [], _distance: 0.2,
      workspace_id: null, session_id: null, agent_type: 'claude',
      project_path: null, file_refs: [], access_count: 0, last_accessed: null,
      metadata: {},
    }]);

    const result = await engine.assemble('test query');
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.context).toContain('<cortex-context>');
  });

  it('completes within performance budget', async () => {
    const start = Date.now();
    await engine.assemble('test query');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);  // generous for CI, target is 150ms
  });
});
```

- [ ] **Step 2: Implement ContextEngine**

```typescript
// src/lib/cortex/retrieval/context-engine.ts
import type { CortexStore } from '../store';
import type { EntityGraph } from '../graph/entity-graph';
import type { EntityResolver, ResolvedEntity } from '../graph/resolver';
import type { EmbeddingProvider } from '../embeddings';
import type { ScoredKnowledge } from '../knowledge/types';
import { detectIntent } from './intent';
import type { IntentResult } from './intent';
import { computeScopeWeight, computeTypeBoost } from './weight';
import { detectConflicts } from './conflict';
import type { ConflictPair } from './conflict';
import { formatContext } from './formatter';
import { computeRelevanceScore } from './scoring';

export interface ContextEngineDeps {
  store: CortexStore;
  graph: EntityGraph;
  resolver: EntityResolver;
  embedding: EmbeddingProvider;
  requesterId: string;  // entity ID of the person making the query
}

export interface AssemblyResult {
  results: ScoredKnowledge[];
  conflicts: ConflictPair[];
  context: string;           // formatted <cortex-context> string
  intent: IntentResult;
  entities: ResolvedEntity[];
  timing: {
    intentMs: number;
    entityMs: number;
    searchMs: number;
    totalMs: number;
  };
}

interface SearchSource {
  layerKey: string;
  weight: number;
  limit: number;
}

const DEFAULT_LAYERS = ['personal', 'workspace', 'team'] as const;
const SEARCH_TIMEOUT_MS = 100;

export class ContextEngine {
  constructor(private deps: ContextEngineDeps) {}

  async assemble(query: string, options: { limit?: number; workspaceId?: number | null; maxTokens?: number } = {}): Promise<AssemblyResult> {
    const totalStart = Date.now();
    const { limit = 5, workspaceId = null, maxTokens = 1500 } = options;

    // Stage 1: Intent Detection
    const intentStart = Date.now();
    const intent = detectIntent(query);
    const intentMs = Date.now() - intentStart;

    // Stage 2: Entity Resolution
    const entityStart = Date.now();
    const entities = this.deps.resolver.extractEntities(query);
    const entityMs = Date.now() - entityStart;

    // Embed the query
    const [queryVector] = await this.deps.embedding.embed([query]);

    // Stage 3: Weight Computation
    const sources = this.computeSourceWeights(intent, workspaceId);

    // Stage 4: Parallel Multi-Source Search
    const searchStart = Date.now();
    const allResults = await this.parallelSearch(queryVector, sources, limit);
    const searchMs = Date.now() - searchStart;

    // Stage 5: Fusion + Re-Ranking
    const fused = this.fuseAndRank(allResults, intent, limit);

    // Stage 6: Conflict Detection + Formatting
    const conflicts = detectConflicts(fused);
    const context = formatContext(fused, conflicts, { maxTokens });

    return {
      results: fused,
      conflicts,
      context,
      intent,
      entities,
      timing: {
        intentMs,
        entityMs,
        searchMs,
        totalMs: Date.now() - totalStart,
      },
    };
  }

  private computeSourceWeights(intent: IntentResult, workspaceId: number | null): SearchSource[] {
    const sources: SearchSource[] = [];

    for (const layer of DEFAULT_LAYERS) {
      const layerKey = layer === 'workspace' && workspaceId
        ? `workspace/${workspaceId}` : layer;

      // Map v1 layer to scope level for intent bias lookup
      const scopeLevel = layer === 'personal' ? 'personal'
        : layer === 'workspace' ? 'team' : 'organization';

      // Use graph proximity if available, else fall back to fixed weights
      let graphProximity: number;
      try {
        // For personal, distance is 0; for workspace, 1; for team, 2
        const layerEntity = layer === 'personal' ? this.deps.requesterId
          : layer === 'workspace' ? 'team-default' : 'organization-default';
        graphProximity = this.deps.graph.proximity(this.deps.requesterId, layerEntity);
      } catch {
        // Graph not populated, use fallback
        graphProximity = layer === 'personal' ? 1.0 : layer === 'workspace' ? 0.5 : 0.33;
      }

      // If graph returns 0 (unreachable/not found), use fallback
      if (graphProximity === 0) {
        graphProximity = layer === 'personal' ? 1.0 : layer === 'workspace' ? 0.5 : 0.33;
      }

      const weight = computeScopeWeight({
        graphProximity,
        scopeLevel,
        intentBiases: intent.biases,
        authorityFactor: 1.0,
      });

      sources.push({
        layerKey,
        weight,
        limit: Math.max(3, Math.round(weight * 10)),  // proportional slots
      });
    }

    return sources.sort((a, b) => b.weight - a.weight);
  }

  private async parallelSearch(
    queryVector: number[],
    sources: SearchSource[],
    limit: number,
  ): Promise<Array<ScoredKnowledge & { sourceWeight: number }>> {
    const searchPromises = sources.map(async (source) => {
      try {
        const results = await Promise.race([
          this.deps.store.search(source.layerKey, queryVector, source.limit),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), SEARCH_TIMEOUT_MS)
          ),
        ]);

        return results.map(unit => {
          const similarity = 1 - ((unit as any)._distance ?? 0);
          return {
            ...unit,
            similarity,
            relevance_score: 0,  // computed in fusion
            sourceWeight: source.weight,
          } as ScoredKnowledge & { sourceWeight: number };
        });
      } catch {
        return [];  // source failed or timed out
      }
    });

    const settled = await Promise.allSettled(searchPromises);
    const allResults: Array<ScoredKnowledge & { sourceWeight: number }> = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        allResults.push(...result.value);
      }
    }

    return allResults;
  }

  private fuseAndRank(
    results: Array<ScoredKnowledge & { sourceWeight: number }>,
    intent: IntentResult,
    limit: number,
  ): ScoredKnowledge[] {
    // Score each result
    for (const result of results) {
      const typeBoost = computeTypeBoost(result.type, intent.biases);
      const recencyBoost = intent.biases.recency_boost;

      result.relevance_score = computeRelevanceScore({
        similarity: result.similarity,
        confidence: result.confidence,
        stale_score: result.stale_score,
        created: result.created,
        evidence_score: result.evidence_score,
      }) * result.sourceWeight * typeBoost * recencyBoost;
    }

    // Deduplicate: cosine > 0.9 between results (approximate via text similarity)
    const deduped = this.deduplicateResults(results);

    // Sort and take top K
    deduped.sort((a, b) => b.relevance_score - a.relevance_score);
    return deduped.slice(0, limit);
  }

  private deduplicateResults(results: ScoredKnowledge[]): ScoredKnowledge[] {
    const kept: ScoredKnowledge[] = [];
    const seenTexts = new Set<string>();

    // Sort by score first so we keep the better-scored version
    results.sort((a, b) => b.relevance_score - a.relevance_score);

    for (const result of results) {
      // Simple text-based dedup: normalize and check prefix overlap
      const normalized = result.text.slice(0, 200).toLowerCase().trim();
      if (seenTexts.has(normalized)) continue;

      // Check against existing kept items for high text overlap
      let isDupe = false;
      for (const existing of kept) {
        if (result.id === existing.id) { isDupe = true; break; }
        // If texts share >80% of content, consider duplicate
        const existNorm = existing.text.slice(0, 200).toLowerCase().trim();
        if (normalized === existNorm) { isDupe = true; break; }
      }

      if (!isDupe) {
        seenTexts.add(normalized);
        kept.push(result);
      }
    }

    return kept;
  }
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run tests/lib/cortex/retrieval/context-engine.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/retrieval/context-engine.ts tests/lib/cortex/retrieval/context-engine.test.ts
git commit -m "feat(cortex): add ContextEngine with 6-stage retrieval pipeline"
```

---

## Chunk 4: API Endpoint and Hook Integration

### Task 6: Context assembly API endpoint

**Files:**
- Create: `src/app/api/cortex/context/route.ts`

- [ ] **Step 1: Create the endpoint**

```typescript
// src/app/api/cortex/context/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';
import { ContextEngine } from '@/lib/cortex/retrieval/context-engine';
import { EntityResolver } from '@/lib/cortex/graph/resolver';
import { slugify } from '@/lib/cortex/graph/types';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ results: [], context: '' });

    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '5', 10);
    const workspaceId = url.searchParams.get('workspace_id');
    const maxTokens = parseInt(url.searchParams.get('max_tokens') || '1500', 10);

    if (!query || query.length < 3) {
      return NextResponse.json({ results: [], context: '' });
    }

    const resolver = new EntityResolver(cortex.graph);
    const requesterId = `person-${slugify(user)}`;

    const engine = new ContextEngine({
      store: cortex.store,
      graph: cortex.graph,
      resolver,
      embedding: cortex.embedding,
      requesterId,
    });

    const result = await engine.assemble(query, {
      limit,
      workspaceId: workspaceId ? parseInt(workspaceId, 10) : null,
      maxTokens,
    });

    return NextResponse.json({
      results: result.results.map(r => ({ ...r, vector: undefined })),  // strip vectors
      context: result.context,
      intent: result.intent,
      conflicts: result.conflicts.length,
      timing: result.timing,
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/cortex/context/route.ts
git commit -m "feat(cortex): add context assembly API endpoint"
```

---

### Task 7: Update RAG hook to use context assembly endpoint

**Files:**
- Modify: `bin/cortex-hook.js`

- [ ] **Step 1: Read current cortex-hook.js**

Read the file to understand the current flow: query → /api/cortex/search → format results → output.

- [ ] **Step 2: Update to call context assembly endpoint**

Change the URL from `/api/cortex/search/?q=...` to `/api/cortex/context/?q=...`. The new endpoint returns `{ context, results, intent, conflicts, timing }` — the `context` field is already pre-formatted as `<cortex-context>`, so the hook can output it directly instead of doing its own formatting.

Key changes:
1. URL: `/api/cortex/search/` → `/api/cortex/context/`
2. Response handling: use `parsed.context` directly instead of formatting results manually
3. Keep the fallback: if the new endpoint returns empty or fails, fall back to old behavior

```javascript
// Replace the response handling section:
const parsed = JSON.parse(body);

// New: context is pre-formatted by the Context Assembly Engine
if (parsed.context) {
  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: parsed.context,
    },
  });
  process.stdout.write(output);
  process.exit(0);
}

// Fallback: old-style results formatting (if context endpoint not available)
const results = parsed.results;
if (!results || results.length === 0) process.exit(0);
// ... existing formatting code stays as fallback ...
```

- [ ] **Step 3: Commit**

```bash
git add bin/cortex-hook.js
git commit -m "feat(cortex): switch RAG hook to context assembly endpoint"
```

---

### Task 8: Integrate ContextEngine into CortexInstance

**Files:**
- Modify: `src/lib/cortex/index.ts`

- [ ] **Step 1: Read current index.ts**

- [ ] **Step 2: Add ContextEngine to CortexInstance**

1. Import: `import { ContextEngine } from './retrieval/context-engine';` and `import { EntityResolver } from './graph/resolver';`
2. Add `contextEngine?: ContextEngine` to `CortexInstance` interface (optional since it depends on graph)
3. In `getCortex()`, after graph initialization, create the ContextEngine:

```typescript
const resolver = new EntityResolver(graph);
const contextEngine = new ContextEngine({
  store,
  graph,
  resolver,
  embedding,
  requesterId: 'person-default-user',  // default; overridden per-request in API
});
```

4. Add to instance object: `contextEngine,`

- [ ] **Step 3: Run full cortex test suite**

Run: `npx vitest run tests/lib/cortex/`

- [ ] **Step 4: Commit**

```bash
git add src/lib/cortex/index.ts
git commit -m "feat(cortex): add ContextEngine to CortexInstance"
```

---

## Summary

| Task | Component | Tests | Status |
|------|-----------|-------|--------|
| 1 | Intent detection | 7 | |
| 2 | Weight computation | 5 | |
| 3 | Conflict detection | 4 | |
| 4 | Context formatter | 6 | |
| 5 | ContextEngine (6-stage pipeline) | 6 | |
| 6 | Context assembly API endpoint | — | |
| 7 | RAG hook integration | — | |
| 8 | CortexInstance integration | regression | |

**Total: 8 tasks, ~28 new tests, 4 chunks**

**Performance budget:** The ContextEngine targets <150ms total latency:
- Intent detection: <5ms (regex, no LLM)
- Entity resolution: <5ms (alias lookup)
- Weight computation: <10ms (graph proximity, cached)
- Parallel search: <100ms (concurrent vector search with 100ms timeout)
- Fusion + formatting: <10ms

**Key design decisions:**
- ContextEngine sits ABOVE CortexSearch — doesn't replace it, wraps it
- Graph proximity drives weights — but gracefully degrades to fixed weights when graph is empty
- Deduplication uses text prefix comparison (not cosine between result vectors — that would require N² vector ops)
- RAG hook uses pre-formatted `context` from the engine — no more client-side formatting
- Old `/api/cortex/search` endpoint still works — new `/api/cortex/context` endpoint adds the intelligence layer
