# Cortex v2 — Pillar 6: Gravity System

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement bi-directional knowledge flow — evidence-based bubble-up promotion, decision trickle-down, conflict detection during ingestion, stale knowledge decay, and a background gravity scheduler that runs every 6 hours.

**Architecture:** A new `src/lib/cortex/gravity/` module with four components: `promotion.ts` (bubble-up logic), `trickle.ts` (push-down logic), `contradiction.ts` (ingestion-time conflict detection), and `scheduler.ts` (background timer orchestrating all gravity operations). Uses the `gravity_state` SQLite table (created in Pillar 1) for checkpoint persistence.

**Tech Stack:** TypeScript, better-sqlite3, LanceDB, vitest

**Spec:** `docs/superpowers/specs/2026-03-14-cortex-v2-design.md` — Pillar 6

**Depends on:** All previous pillars (1-5) — completed

---

## File Structure

```
New files:
├── src/lib/cortex/gravity/promotion.ts       — Bubble-up: evidence-based promotion
├── src/lib/cortex/gravity/trickle.ts         — Trickle-down: decision push + visibility
├── src/lib/cortex/gravity/contradiction.ts   — Ingestion-time conflict detection
├── src/lib/cortex/gravity/decay.ts           — Stale knowledge decay + archival
├── src/lib/cortex/gravity/scheduler.ts       — Background scheduler (setInterval)
├── src/lib/cortex/gravity/index.ts           — Barrel export

Modified files:
├── src/lib/cortex/index.ts                   — Add GravityScheduler to CortexInstance

Test files:
├── tests/lib/cortex/gravity/promotion.test.ts
├── tests/lib/cortex/gravity/trickle.test.ts
├── tests/lib/cortex/gravity/contradiction.test.ts
├── tests/lib/cortex/gravity/decay.test.ts
├── tests/lib/cortex/gravity/scheduler.test.ts
```

---

## Chunk 1: Promotion and Trickle-Down

### Task 1: Bubble-up promotion logic

**Files:**
- Create: `src/lib/cortex/gravity/promotion.ts`
- Create: `tests/lib/cortex/gravity/promotion.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/gravity/promotion.test.ts
import { describe, it, expect } from 'vitest';
import {
  computePromotionScore,
  shouldPromote,
  PROMOTION_TYPE_WEIGHTS,
} from '@/lib/cortex/gravity/promotion';

describe('computePromotionScore', () => {
  it('computes score from evidence, type weight, and freshness', () => {
    const score = computePromotionScore({
      evidenceScore: 0.8,
      type: 'decision',
      createdDaysAgo: 10,
    });
    // 0.8 * 1.5 (decision weight) * 1.0 (< 30 days) = 1.2 → capped at 1.0
    expect(score).toBeLessThanOrEqual(1.0);
    expect(score).toBeGreaterThan(0.5);
  });

  it('applies type weights correctly', () => {
    const decision = computePromotionScore({ evidenceScore: 0.5, type: 'decision', createdDaysAgo: 10 });
    const conversation = computePromotionScore({ evidenceScore: 0.5, type: 'conversation', createdDaysAgo: 10 });
    expect(decision).toBeGreaterThan(conversation);
  });

  it('decays with age', () => {
    const recent = computePromotionScore({ evidenceScore: 0.8, type: 'pattern', createdDaysAgo: 5 });
    const old = computePromotionScore({ evidenceScore: 0.8, type: 'pattern', createdDaysAgo: 120 });
    expect(recent).toBeGreaterThan(old);
  });
});

describe('shouldPromote', () => {
  it('promotes personal→team when score and corroborations meet threshold', () => {
    expect(shouldPromote({
      currentLevel: 'personal',
      promotionScore: 0.7,
      corroborations: 3,
      sensitivity: 'internal',
      hasContradictions: false,
    })).toBe(true);
  });

  it('blocks promotion when sensitivity is restricted', () => {
    expect(shouldPromote({
      currentLevel: 'personal',
      promotionScore: 0.7,
      corroborations: 3,
      sensitivity: 'restricted',
      hasContradictions: false,
    })).toBe(false);
  });

  it('blocks promotion when corroborations insufficient', () => {
    expect(shouldPromote({
      currentLevel: 'personal',
      promotionScore: 0.7,
      corroborations: 1,  // needs ≥ 2
      sensitivity: 'internal',
      hasContradictions: false,
    })).toBe(false);
  });

  it('blocks dept→org promotion when contradictions exist', () => {
    expect(shouldPromote({
      currentLevel: 'department',
      promotionScore: 0.95,
      corroborations: 6,
      sensitivity: 'internal',
      hasContradictions: true,
    })).toBe(false);
  });

  it('requires higher thresholds for higher promotions', () => {
    // Score 0.65 passes personal→team but not team→dept
    expect(shouldPromote({
      currentLevel: 'personal', promotionScore: 0.65, corroborations: 2,
      sensitivity: 'internal', hasContradictions: false,
    })).toBe(true);

    expect(shouldPromote({
      currentLevel: 'team', promotionScore: 0.65, corroborations: 3,
      sensitivity: 'internal', hasContradictions: false,
    })).toBe(false);  // needs ≥ 0.75
  });
});
```

- [ ] **Step 2: Implement promotion logic**

```typescript
// src/lib/cortex/gravity/promotion.ts
import type { KnowledgeType, ScopeLevel, SensitivityClass } from '../knowledge/types';

export const PROMOTION_TYPE_WEIGHTS: Record<string, number> = {
  decision: 1.5,
  error_fix: 1.3,
  pattern: 1.2,
  preference: 1.0,
  code_pattern: 1.0,
  command: 0.8,
  context: 0.7,
  summary: 0.7,
  conversation: 0.5,
};

const FRESHNESS_THRESHOLDS = [
  { maxDays: 30, multiplier: 1.0 },
  { maxDays: 90, multiplier: 0.8 },
  { maxDays: Infinity, multiplier: 0.5 },
];

interface PromotionScoreInput {
  evidenceScore: number;
  type: string;
  createdDaysAgo: number;
}

export function computePromotionScore(input: PromotionScoreInput): number {
  const typeWeight = PROMOTION_TYPE_WEIGHTS[input.type] ?? 1.0;
  const freshness = FRESHNESS_THRESHOLDS.find(t => input.createdDaysAgo <= t.maxDays)?.multiplier ?? 0.5;
  return Math.min(1.0, input.evidenceScore * typeWeight * freshness);
}

interface PromotionCheck {
  currentLevel: ScopeLevel;
  promotionScore: number;
  corroborations: number;
  sensitivity: string;
  hasContradictions: boolean;
}

const PROMOTION_THRESHOLDS: Record<string, { minScore: number; minCorroborations: number; noContradictions?: boolean }> = {
  personal: { minScore: 0.6, minCorroborations: 2 },
  team: { minScore: 0.75, minCorroborations: 3 },
  department: { minScore: 0.9, minCorroborations: 5, noContradictions: true },
};

const NEXT_LEVEL: Record<string, ScopeLevel> = {
  personal: 'team',
  team: 'department',
  department: 'organization',
};

export function shouldPromote(check: PromotionCheck): boolean {
  const threshold = PROMOTION_THRESHOLDS[check.currentLevel];
  if (!threshold) return false;  // organization can't promote further

  if (check.sensitivity === 'restricted' || check.sensitivity === 'confidential') return false;
  if (check.promotionScore < threshold.minScore) return false;
  if (check.corroborations < threshold.minCorroborations) return false;
  if (threshold.noContradictions && check.hasContradictions) return false;

  return true;
}

export function getNextLevel(current: ScopeLevel): ScopeLevel | null {
  return NEXT_LEVEL[current] ?? null;
}

export const HOP_DECAY = 0.85;
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(cortex): add evidence-based promotion logic for gravity system"
```

---

### Task 2: Trickle-down logic

**Files:**
- Create: `src/lib/cortex/gravity/trickle.ts`
- Create: `tests/lib/cortex/gravity/trickle.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/gravity/trickle.test.ts
import { describe, it, expect } from 'vitest';
import { getTrickleMode, TRICKLE_DEFAULTS } from '@/lib/cortex/gravity/trickle';

describe('getTrickleMode', () => {
  it('returns PUSH for org decisions', () => {
    expect(getTrickleMode('decision', 'organization')).toBe('push');
  });

  it('returns PUSH for security policies', () => {
    expect(getTrickleMode('error_fix', 'organization', ['security'])).toBe('push');
  });

  it('returns VISIBILITY for best practices', () => {
    expect(getTrickleMode('pattern', 'organization')).toBe('visibility');
  });

  it('returns VISIBILITY for general patterns', () => {
    expect(getTrickleMode('conversation', 'organization')).toBe('visibility');
  });

  it('returns null for non-org scopes', () => {
    expect(getTrickleMode('decision', 'team')).toBeNull();
  });

  it('exports trickle defaults table', () => {
    expect(TRICKLE_DEFAULTS).toBeDefined();
    expect(TRICKLE_DEFAULTS.decision).toBe('push');
    expect(TRICKLE_DEFAULTS.pattern).toBe('visibility');
  });
});
```

- [ ] **Step 2: Implement trickle-down**

```typescript
// src/lib/cortex/gravity/trickle.ts
import type { KnowledgeType, ScopeLevel } from '../knowledge/types';

export type TrickleMode = 'push' | 'visibility';

export const TRICKLE_DEFAULTS: Record<string, TrickleMode> = {
  decision: 'push',
  preference: 'push',
  error_fix: 'visibility',
  pattern: 'visibility',
  code_pattern: 'visibility',
  command: 'visibility',
  context: 'visibility',
  conversation: 'visibility',
  summary: 'visibility',
};

const SECURITY_TOPICS = ['security', 'vulnerability', 'exploit', 'cve', 'incident'];

/**
 * Determine trickle mode for knowledge at a given scope.
 * Only org-level knowledge trickles down.
 * Returns null if knowledge shouldn't trickle (not at org scope).
 */
export function getTrickleMode(
  type: string,
  scopeLevel: string,
  topics?: string[],
): TrickleMode | null {
  // Only org-level knowledge trickles down
  if (scopeLevel !== 'organization') return null;

  // Security topics always push
  if (topics?.some(t => SECURITY_TOPICS.includes(t.toLowerCase()))) {
    return 'push';
  }

  return TRICKLE_DEFAULTS[type] ?? 'visibility';
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(cortex): add trickle-down logic for gravity system"
```

---

## Chunk 2: Contradiction Detection and Decay

### Task 3: Ingestion-time contradiction detection

**Files:**
- Create: `src/lib/cortex/gravity/contradiction.ts`
- Create: `tests/lib/cortex/gravity/contradiction.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/gravity/contradiction.test.ts
import { describe, it, expect } from 'vitest';
import {
  detectSentimentConflict,
  CONTRADICTION_KEYWORDS,
} from '@/lib/cortex/gravity/contradiction';

describe('detectSentimentConflict', () => {
  it('detects opposing sentiments', () => {
    expect(detectSentimentConflict(
      'increase connection pool size to 50',
      'do NOT increase pool size, scale horizontally instead',
    )).toBe(true);
  });

  it('returns false for agreeing statements', () => {
    expect(detectSentimentConflict(
      'use PostgreSQL for the new service',
      'PostgreSQL is the right choice for reliability',
    )).toBe(false);
  });

  it('detects negation patterns', () => {
    expect(detectSentimentConflict(
      'we should use Redis for caching',
      'we should not use Redis for caching',
    )).toBe(true);
  });

  it('detects replacement/alternative patterns', () => {
    expect(detectSentimentConflict(
      'use Express for the API',
      'use Fastify instead of Express',
    )).toBe(true);
  });

  it('returns false for unrelated statements', () => {
    expect(detectSentimentConflict(
      'the auth service handles JWT',
      'deploy to production on Fridays',
    )).toBe(false);
  });
});
```

- [ ] **Step 2: Implement contradiction detection**

```typescript
// src/lib/cortex/gravity/contradiction.ts

export const CONTRADICTION_KEYWORDS = {
  negation: [/\bnot\b/i, /\bdon't\b/i, /\bdo\s+not\b/i, /\bnever\b/i, /\bavoid\b/i, /\bstop\b/i],
  replacement: [/\binstead\s+of\b/i, /\brather\s+than\b/i, /\breplace\b.*\bwith\b/i, /\bswitch\s+(from|to)\b/i],
  opposition: [/\bhowever\b/i, /\bbut\b/i, /\bcontra/i, /\boppos/i],
};

/**
 * Detect if two texts express conflicting conclusions.
 * Uses keyword-based sentiment analysis (no LLM needed).
 *
 * Returns true if text B appears to contradict text A.
 */
export function detectSentimentConflict(textA: string, textB: string): boolean {
  const lowerB = textB.toLowerCase();
  const lowerA = textA.toLowerCase();

  // Check if B contains negation of key terms from A
  const aWords = extractKeyTerms(lowerA);
  const bWords = extractKeyTerms(lowerB);

  // If B negates something A asserts
  for (const patterns of Object.values(CONTRADICTION_KEYWORDS)) {
    for (const pattern of patterns) {
      if (pattern.test(textB)) {
        // B has negation/replacement language
        // Check if they share subject matter (at least 2 common key terms)
        const commonTerms = aWords.filter(w => bWords.includes(w));
        if (commonTerms.length >= 2) return true;
      }
    }
  }

  return false;
}

function extractKeyTerms(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'we', 'should', 'it',
    'this', 'that', 'and', 'or', 'but', 'not', 'do', 'does', 'did', 'has', 'have', 'had']);
  return text.split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w));
}

export const CONTRADICTION_COSINE_THRESHOLD = 0.80;
export const DEDUP_COSINE_THRESHOLD = 0.90;
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(cortex): add ingestion-time contradiction detection"
```

---

### Task 4: Stale knowledge decay

**Files:**
- Create: `src/lib/cortex/gravity/decay.ts`
- Create: `tests/lib/cortex/gravity/decay.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/gravity/decay.test.ts
import { describe, it, expect } from 'vitest';
import { computeDecay, shouldArchive, ARCHIVE_THRESHOLD } from '@/lib/cortex/gravity/decay';

describe('computeDecay', () => {
  it('returns 0 decay for recently accessed knowledge', () => {
    expect(computeDecay({ daysSinceAccess: 5, currentEvidenceScore: 0.8 })).toBeCloseTo(0);
  });

  it('returns small decay for moderately old knowledge', () => {
    const decay = computeDecay({ daysSinceAccess: 60, currentEvidenceScore: 0.8 });
    expect(decay).toBeGreaterThan(0);
    expect(decay).toBeLessThan(0.2);
  });

  it('returns larger decay for very old knowledge', () => {
    const moderate = computeDecay({ daysSinceAccess: 60, currentEvidenceScore: 0.8 });
    const old = computeDecay({ daysSinceAccess: 180, currentEvidenceScore: 0.8 });
    expect(old).toBeGreaterThan(moderate);
  });

  it('never makes evidence score negative', () => {
    const decay = computeDecay({ daysSinceAccess: 365, currentEvidenceScore: 0.1 });
    expect(0.1 - decay).toBeGreaterThanOrEqual(0);
  });
});

describe('shouldArchive', () => {
  it('archives units with evidence below threshold after 6 months', () => {
    expect(shouldArchive({ evidenceScore: 0.05, daysSinceCreated: 200 })).toBe(true);
  });

  it('does not archive recent units even with low evidence', () => {
    expect(shouldArchive({ evidenceScore: 0.05, daysSinceCreated: 30 })).toBe(false);
  });

  it('does not archive units above threshold', () => {
    expect(shouldArchive({ evidenceScore: 0.5, daysSinceCreated: 200 })).toBe(false);
  });

  it('uses ARCHIVE_THRESHOLD of 0.1', () => {
    expect(ARCHIVE_THRESHOLD).toBe(0.1);
  });
});
```

- [ ] **Step 2: Implement decay**

```typescript
// src/lib/cortex/gravity/decay.ts

export const ARCHIVE_THRESHOLD = 0.1;
const ARCHIVE_MIN_AGE_DAYS = 180;  // 6 months
const DECAY_START_DAYS = 30;  // no decay within first 30 days of last access

interface DecayInput {
  daysSinceAccess: number;
  currentEvidenceScore: number;
}

/**
 * Compute evidence score decay for unaccessed knowledge.
 * Returns the amount to SUBTRACT from evidence_score.
 *
 * Decay formula: gradual increase after 30 days of no access.
 * decay = max(0, (daysSinceAccess - 30) / 365) * 0.2
 * Capped so evidence never goes below 0.
 */
export function computeDecay(input: DecayInput): number {
  const { daysSinceAccess, currentEvidenceScore } = input;

  if (daysSinceAccess <= DECAY_START_DAYS) return 0;

  const rawDecay = ((daysSinceAccess - DECAY_START_DAYS) / 365) * 0.2;
  return Math.min(rawDecay, currentEvidenceScore);  // never go below 0
}

interface ArchiveCheck {
  evidenceScore: number;
  daysSinceCreated: number;
}

/**
 * Determine if a knowledge unit should be archived.
 * Archived when evidence < ARCHIVE_THRESHOLD and older than 6 months.
 */
export function shouldArchive(check: ArchiveCheck): boolean {
  return check.evidenceScore < ARCHIVE_THRESHOLD && check.daysSinceCreated >= ARCHIVE_MIN_AGE_DAYS;
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(cortex): add knowledge decay and archival logic"
```

---

## Chunk 3: Gravity Scheduler and Integration

### Task 5: Gravity scheduler

**Files:**
- Create: `src/lib/cortex/gravity/scheduler.ts`
- Create: `tests/lib/cortex/gravity/scheduler.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/gravity/scheduler.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GravityScheduler } from '@/lib/cortex/gravity/scheduler';

describe('GravityScheduler', () => {
  let scheduler: GravityScheduler;
  const mockRunCycle = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new GravityScheduler({
      intervalMs: 1000,  // 1 second for testing (real: 6 hours)
      runCycle: mockRunCycle,
    });
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it('starts and runs the first cycle', async () => {
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    // First cycle runs immediately
    await vi.advanceTimersByTimeAsync(10);
    expect(mockRunCycle).toHaveBeenCalledTimes(1);
  });

  it('runs on interval', async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);     // first immediate run
    await vi.advanceTimersByTimeAsync(1000);   // second interval run
    expect(mockRunCycle).toHaveBeenCalledTimes(2);
  });

  it('stops cleanly', async () => {
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(mockRunCycle).toHaveBeenCalledTimes(1);  // no more runs after stop
  });

  it('does not run concurrent cycles', async () => {
    let resolveFirst: () => void;
    const slowCycle = vi.fn().mockImplementation(() =>
      new Promise<void>(resolve => { resolveFirst = resolve; })
    );
    const slow = new GravityScheduler({ intervalMs: 100, runCycle: slowCycle });
    slow.start();
    await vi.advanceTimersByTimeAsync(10);    // starts first cycle
    await vi.advanceTimersByTimeAsync(200);   // interval fires but first still running
    expect(slowCycle).toHaveBeenCalledTimes(1);
    resolveFirst!();
    slow.stop();
  });

  it('handles cycle errors without crashing', async () => {
    const failingCycle = vi.fn().mockRejectedValue(new Error('cycle failed'));
    const failing = new GravityScheduler({ intervalMs: 1000, runCycle: failingCycle });
    failing.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(failing.isRunning()).toBe(true);  // still running despite error
    failing.stop();
  });
});
```

- [ ] **Step 2: Implement scheduler**

```typescript
// src/lib/cortex/gravity/scheduler.ts

export const GRAVITY_INTERVAL_MS = 6 * 60 * 60 * 1000;  // 6 hours

export interface GravitySchedulerConfig {
  intervalMs?: number;
  runCycle: () => Promise<void>;
}

export class GravityScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private cycling = false;
  private config: Required<GravitySchedulerConfig>;

  constructor(config: GravitySchedulerConfig) {
    this.config = {
      intervalMs: config.intervalMs ?? GRAVITY_INTERVAL_MS,
      runCycle: config.runCycle,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Run first cycle immediately (non-blocking)
    this.executeCycle();

    // Schedule recurring cycles
    this.timer = setInterval(() => this.executeCycle(), this.config.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private async executeCycle(): Promise<void> {
    if (this.cycling) return;  // prevent concurrent cycles
    this.cycling = true;
    try {
      await this.config.runCycle();
    } catch {
      // Log but don't crash — scheduler continues
    } finally {
      this.cycling = false;
    }
  }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(cortex): add gravity scheduler with interval execution"
```

---

### Task 6: Barrel export and CortexInstance integration

**Files:**
- Create: `src/lib/cortex/gravity/index.ts`
- Modify: `src/lib/cortex/index.ts`

- [ ] **Step 1: Create barrel export**

```typescript
// src/lib/cortex/gravity/index.ts
export { computePromotionScore, shouldPromote, getNextLevel, HOP_DECAY, PROMOTION_TYPE_WEIGHTS } from './promotion';
export { getTrickleMode, TRICKLE_DEFAULTS } from './trickle';
export type { TrickleMode } from './trickle';
export { detectSentimentConflict, CONTRADICTION_COSINE_THRESHOLD, DEDUP_COSINE_THRESHOLD } from './contradiction';
export { computeDecay, shouldArchive, ARCHIVE_THRESHOLD } from './decay';
export { GravityScheduler, GRAVITY_INTERVAL_MS } from './scheduler';
export type { GravitySchedulerConfig } from './scheduler';
```

- [ ] **Step 2: Add GravityScheduler to CortexInstance**

Read `src/lib/cortex/index.ts`. Add:

1. Import: `import { GravityScheduler } from './gravity/scheduler';`
2. Add `gravityScheduler?: GravityScheduler` to CortexInstance interface
3. In getCortex(), after signalPipeline initialization:

```typescript
const gravityScheduler = new GravityScheduler({
  runCycle: async () => {
    // Gravity cycle placeholder — full implementation requires
    // scanning all knowledge units, computing promotion scores,
    // executing trickle-down, decaying stale knowledge, etc.
    // Individual functions are ready; the orchestration wiring
    // will be connected when the system has enough data to test.
  },
});
// Don't auto-start — let the application decide when to start
```

4. Include `gravityScheduler` in instance object
5. In `resetCortex()`, add `_instance.gravityScheduler?.stop()` before nulling

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run tests/lib/cortex/
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cortex): add gravity module barrel export and CortexInstance integration"
```

---

## Summary

| Task | Component | Tests | Status |
|------|-----------|-------|--------|
| 1 | Promotion (bubble-up) | 8 | |
| 2 | Trickle-down | 6 | |
| 3 | Contradiction detection | 5 | |
| 4 | Decay + archival | 8 | |
| 5 | Gravity scheduler | 5 | |
| 6 | Barrel export + integration | regression | |

**Total: 6 tasks, ~32 new tests, 3 chunks**

**Key design decisions:**
- Promotion is COPY (not move) — original stays, promoted copy gets decayed confidence (×0.85)
- Trickle-down has two modes: PUSH (copies to lower scopes) and VISIBILITY (accessible via graph but not copied)
- Contradiction detection uses keyword-based sentiment analysis (not LLM) — fast and deterministic
- Decay is gradual — starts after 30 days of no access, increases over time, archives below 0.1 after 6 months
- Scheduler uses setInterval (consistent with FederationSync pattern), prevents concurrent cycles, survives errors
- The runCycle body is a placeholder — individual gravity functions are ready but the full orchestration loop connecting them to store iteration will be wired when there's enough data to test against
