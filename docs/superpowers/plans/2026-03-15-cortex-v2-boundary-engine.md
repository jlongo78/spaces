# Cortex v2 — Pillar 4: Boundary Engine

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three-layer access control to Cortex: auto-classification of sensitivity, organizational policies, and creator overrides — ensuring confidential knowledge never leaks across scope boundaries.

**Architecture:** A new `src/lib/cortex/boundary/` module with three components: a `Classifier` (regex-based sensitivity detection), a `PolicyEngine` (rule evaluation), and an `AccessFilter` (query-time enforcement). The AccessFilter integrates with the ContextEngine to pre-filter scopes before search. An audit log records all access decisions in the entity graph's SQLite database.

**Tech Stack:** TypeScript, better-sqlite3 (existing graph DB), vitest

**Spec:** `docs/superpowers/specs/2026-03-14-cortex-v2-design.md` — Pillar 4

**Depends on:** Pillar 1 (Entity Graph) + Pillar 2 (Knowledge Unit Evolution) — both completed

---

## File Structure

```
New files:
├── src/lib/cortex/boundary/classifier.ts    — Auto-classification (Layer 1)
├── src/lib/cortex/boundary/policy.ts        — Policy engine (Layer 2)
├── src/lib/cortex/boundary/access.ts        — Query-time access filter (Layer 3 + enforcement)
├── src/lib/cortex/boundary/audit.ts         — Audit trail logging
├── src/lib/cortex/boundary/index.ts         — Barrel export

Modified files:
├── src/lib/cortex/ingestion/pipeline.ts     — Auto-classify on ingestion
├── src/lib/cortex/retrieval/context-engine.ts — Pre-filter with AccessFilter
├── src/lib/cortex/config.ts                 — Add policies to config

Test files:
├── tests/lib/cortex/boundary/classifier.test.ts
├── tests/lib/cortex/boundary/policy.test.ts
├── tests/lib/cortex/boundary/access.test.ts
├── tests/lib/cortex/boundary/audit.test.ts
```

---

## Chunk 1: Auto-Classification and Policy Engine

### Task 1: Sensitivity auto-classifier

**Files:**
- Create: `src/lib/cortex/boundary/classifier.ts`
- Create: `tests/lib/cortex/boundary/classifier.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/boundary/classifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifySensitivity } from '@/lib/cortex/boundary/classifier';

describe('classifySensitivity', () => {
  it('classifies secrets as confidential', () => {
    expect(classifySensitivity('Set API_KEY=sk-ant-abc123 in .env')).toBe('confidential');
    expect(classifySensitivity('password: hunter2')).toBe('confidential');
    expect(classifySensitivity('DATABASE_URL=postgres://user:pass@host')).toBe('confidential');
  });

  it('classifies personnel content as confidential', () => {
    expect(classifySensitivity('Alice performance review: exceeds expectations')).toBe('confidential');
    expect(classifySensitivity('salary adjustment from 120k to 140k')).toBe('confidential');
  });

  it('classifies security content as restricted', () => {
    expect(classifySensitivity('Found SQL injection vulnerability in login endpoint')).toBe('restricted');
    expect(classifySensitivity('CVE-2024-1234 affects our auth library')).toBe('restricted');
  });

  it('classifies business content as restricted', () => {
    expect(classifySensitivity('Q3 revenue was $2.5M, below target')).toBe('restricted');
    expect(classifySensitivity('Unreleased product launch planned for April')).toBe('restricted');
  });

  it('classifies technical content as internal', () => {
    expect(classifySensitivity('We decided to use PostgreSQL for the new service')).toBe('internal');
    expect(classifySensitivity('The auth middleware handles JWT validation')).toBe('internal');
  });

  it('classifies general content as public', () => {
    expect(classifySensitivity('How to use git rebase')).toBe('public');
    expect(classifySensitivity('JavaScript array methods')).toBe('public');
  });

  it('returns most restrictive when multiple detectors match', () => {
    // Has both secret (confidential) and security (restricted) signals
    expect(classifySensitivity('API_KEY leaked in CVE-2024-1234')).toBe('confidential');
  });
});
```

- [ ] **Step 2: Implement classifier**

```typescript
// src/lib/cortex/boundary/classifier.ts
import type { SensitivityClass } from '../knowledge/types';

interface Detector {
  sensitivity: SensitivityClass;
  patterns: RegExp[];
  priority: number;  // higher = more restrictive
}

const DETECTORS: Detector[] = [
  {
    sensitivity: 'confidential',
    priority: 4,
    patterns: [
      // Secrets
      /\b(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token)\s*[=:]/i,
      /\b(password|passwd|pwd)\s*[=:]/i,
      /\bsk-[a-z]{2,4}-[a-zA-Z0-9]{10,}/,  // Anthropic/OpenAI key format
      /\b(DATABASE_URL|REDIS_URL|MONGO_URI)\s*=/i,
      /\bpostgres:\/\/\w+:\w+@/i,
      /\b(private[_-]?key|ssh[_-]?key)\b/i,
      // Personnel
      /\b(performance\s+review|annual\s+review)\b/i,
      /\b(salary|compensation|pay\s+raise|pay\s+cut)\b/i,
      /\b(hiring|termination|fired|let\s+go)\b/i,
      /\b(1:1\s+notes?|one[\s-]on[\s-]one)\b/i,
    ],
  },
  {
    sensitivity: 'restricted',
    priority: 3,
    patterns: [
      // Security
      /\b(vulnerab|exploit|attack\s+vector|injection|xss|csrf|ssrf)\b/i,
      /\bCVE-\d{4}-\d+/i,
      /\b(incident\s+report|security\s+breach|data\s+leak)\b/i,
      // Business
      /\b(revenue|profit|loss|earnings|ARR|MRR)\b/i,
      /\b(unreleased|pre-launch|confidential\s+plan|roadmap)\b/i,
      /\bcustomer\s+(data|records|PII)\b/i,
    ],
  },
  {
    sensitivity: 'internal',
    priority: 2,
    patterns: [
      /\b(we\s+decided|architecture|design\s+pattern|refactor)\b/i,
      /\b(middleware|service|endpoint|database|schema)\b/i,
      /\b(deployment|CI\/CD|pipeline|infrastructure)\b/i,
      /\b(bug\s+fix|pull\s+request|code\s+review)\b/i,
    ],
  },
];

export function classifySensitivity(text: string): SensitivityClass {
  let highestPriority = 0;
  let result: SensitivityClass = 'public';

  for (const detector of DETECTORS) {
    if (detector.priority <= highestPriority) continue;
    for (const pattern of detector.patterns) {
      if (pattern.test(text)) {
        highestPriority = detector.priority;
        result = detector.sensitivity;
        break;
      }
    }
  }

  return result;
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(cortex): add sensitivity auto-classifier for boundary engine"
```

---

### Task 2: Policy engine

**Files:**
- Create: `src/lib/cortex/boundary/policy.ts`
- Create: `tests/lib/cortex/boundary/policy.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/boundary/policy.test.ts
import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '@/lib/cortex/boundary/policy';
import type { Policy } from '@/lib/cortex/boundary/policy';

describe('PolicyEngine', () => {
  it('returns empty actions when no policies match', () => {
    const engine = new PolicyEngine([]);
    const actions = engine.evaluate({ type: 'decision', sensitivity: 'internal' });
    expect(actions).toEqual([]);
  });

  it('matches by knowledge type', () => {
    const policies: Policy[] = [{
      name: 'arch-decisions-propagate',
      match: { type: 'decision' },
      action: { propagate_to: [{ level: 'department' }] },
    }];
    const engine = new PolicyEngine(policies);
    const actions = engine.evaluate({ type: 'decision', sensitivity: 'internal' });
    expect(actions).toHaveLength(1);
    expect(actions[0].propagate_to).toEqual([{ level: 'department' }]);
  });

  it('matches by sensitivity', () => {
    const policies: Policy[] = [{
      name: 'lock-confidential',
      match: { sensitivity: 'confidential' },
      action: { cannot_propagate: true },
    }];
    const engine = new PolicyEngine(policies);
    const actions = engine.evaluate({ type: 'pattern', sensitivity: 'confidential' });
    expect(actions).toHaveLength(1);
    expect(actions[0].cannot_propagate).toBe(true);
  });

  it('matches by topics', () => {
    const policies: Policy[] = [{
      name: 'security-routing',
      match: { topics: ['security', 'vulnerability'] },
      action: { max_scope: 'department', propagate_to: [{ level: 'team', entity_id: 'team-security' }] },
    }];
    const engine = new PolicyEngine(policies);
    const actions = engine.evaluate({ type: 'error_fix', sensitivity: 'restricted', topics: ['security'] });
    expect(actions).toHaveLength(1);
    expect(actions[0].max_scope).toBe('department');
  });

  it('returns multiple matching policies', () => {
    const policies: Policy[] = [
      { name: 'p1', match: { type: 'decision' }, action: { trickle_down: true } },
      { name: 'p2', match: { sensitivity: 'internal' }, action: { max_scope: 'organization' } },
    ];
    const engine = new PolicyEngine(policies);
    const actions = engine.evaluate({ type: 'decision', sensitivity: 'internal' });
    expect(actions).toHaveLength(2);
  });

  it('does not match when criteria do not overlap', () => {
    const policies: Policy[] = [{
      name: 'security-only',
      match: { topics: ['security'] },
      action: { cannot_propagate: true },
    }];
    const engine = new PolicyEngine(policies);
    const actions = engine.evaluate({ type: 'decision', sensitivity: 'internal', topics: ['architecture'] });
    expect(actions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement policy engine**

```typescript
// src/lib/cortex/boundary/policy.ts
import type { KnowledgeType, SensitivityClass, ScopeLevel } from '../knowledge/types';

export interface PropagationTarget {
  level: ScopeLevel;
  entity_id?: string;
}

export interface PolicyAction {
  max_scope?: ScopeLevel;
  propagate_to?: PropagationTarget[];
  trickle_down?: boolean;
  cannot_propagate?: boolean;
}

export interface Policy {
  name: string;
  match: {
    type?: KnowledgeType;
    topics?: string[];
    sensitivity?: SensitivityClass;
    scope_level?: ScopeLevel;
  };
  action: PolicyAction;
}

export interface PolicyMatchInput {
  type: KnowledgeType | string;
  sensitivity: SensitivityClass | string;
  topics?: string[];
  scope_level?: ScopeLevel | string;
}

export class PolicyEngine {
  constructor(private policies: Policy[]) {}

  evaluate(input: PolicyMatchInput): PolicyAction[] {
    const matched: PolicyAction[] = [];

    for (const policy of this.policies) {
      if (this.matches(policy, input)) {
        matched.push(policy.action);
      }
    }

    return matched;
  }

  private matches(policy: Policy, input: PolicyMatchInput): boolean {
    const { match } = policy;

    if (match.type && match.type !== input.type) return false;
    if (match.sensitivity && match.sensitivity !== input.sensitivity) return false;
    if (match.scope_level && match.scope_level !== input.scope_level) return false;

    if (match.topics && match.topics.length > 0) {
      const inputTopics = input.topics ?? [];
      const hasOverlap = match.topics.some(t => inputTopics.includes(t));
      if (!hasOverlap) return false;
    }

    return true;
  }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(cortex): add policy engine for boundary enforcement"
```

---

## Chunk 2: Access Filter and Audit Trail

### Task 3: Query-time access filter

**Files:**
- Create: `src/lib/cortex/boundary/access.ts`
- Create: `tests/lib/cortex/boundary/access.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/boundary/access.test.ts
import { describe, it, expect } from 'vitest';
import { AccessFilter } from '@/lib/cortex/boundary/access';
import type { ScoredKnowledge } from '@/lib/cortex/knowledge/types';

function makeUnit(overrides: Partial<ScoredKnowledge> = {}): ScoredKnowledge {
  return {
    id: 'k1', vector: [], text: 'test', type: 'decision', layer: 'personal',
    workspace_id: null, session_id: null, agent_type: 'claude',
    project_path: null, file_refs: [], confidence: 0.8,
    created: new Date().toISOString(), source_timestamp: new Date().toISOString(),
    stale_score: 0, access_count: 0, last_accessed: null, metadata: {},
    relevance_score: 0.9, similarity: 0.9,
    sensitivity: 'internal',
    scope: { level: 'personal', entity_id: 'person-alice' },
    origin: { source_type: 'conversation', source_ref: '', creator_entity_id: 'person-alice' },
    ...overrides,
  };
}

describe('AccessFilter', () => {
  const filter = new AccessFilter({
    requesterId: 'person-alice',
    requesterScope: { level: 'team', entity_id: 'team-platform' },
    requesterOrg: 'organization-acme',
  });

  it('allows public knowledge from anywhere in org', () => {
    const unit = makeUnit({ sensitivity: 'public', scope: { level: 'organization', entity_id: 'org-acme' } });
    expect(filter.canAccess(unit)).toBe(true);
  });

  it('allows internal knowledge within org', () => {
    const unit = makeUnit({ sensitivity: 'internal', scope: { level: 'team', entity_id: 'team-other' } });
    expect(filter.canAccess(unit)).toBe(true);
  });

  it('allows restricted knowledge within same scope', () => {
    const unit = makeUnit({
      sensitivity: 'restricted',
      scope: { level: 'team', entity_id: 'team-platform' },
    });
    expect(filter.canAccess(unit)).toBe(true);
  });

  it('denies restricted knowledge from different department', () => {
    const unit = makeUnit({
      sensitivity: 'restricted',
      scope: { level: 'department', entity_id: 'department-sales' },
    });
    // Alice is in team-platform, not department-sales
    expect(filter.canAccess(unit)).toBe(false);
  });

  it('allows confidential knowledge from self', () => {
    const unit = makeUnit({
      sensitivity: 'confidential',
      scope: { level: 'personal', entity_id: 'person-alice' },
      origin: { source_type: 'conversation', source_ref: '', creator_entity_id: 'person-alice' },
    });
    expect(filter.canAccess(unit)).toBe(true);
  });

  it('denies confidential knowledge from others', () => {
    const unit = makeUnit({
      sensitivity: 'confidential',
      scope: { level: 'personal', entity_id: 'person-bob' },
      origin: { source_type: 'conversation', source_ref: '', creator_entity_id: 'person-bob' },
    });
    expect(filter.canAccess(unit)).toBe(false);
  });

  it('respects creator_scope override (further restriction)', () => {
    const unit = makeUnit({
      sensitivity: 'internal',  // normally accessible org-wide
      creator_scope: { max_level: 'personal' },  // but creator restricted to personal only
      scope: { level: 'personal', entity_id: 'person-bob' },
    });
    // Alice can't access Bob's personal-restricted knowledge even though it's internal
    expect(filter.canAccess(unit)).toBe(false);
  });

  it('filters a list of results', () => {
    const results = [
      makeUnit({ id: 'a', sensitivity: 'public' }),
      makeUnit({ id: 'b', sensitivity: 'confidential', origin: { source_type: 'conversation', source_ref: '', creator_entity_id: 'person-bob' } }),
      makeUnit({ id: 'c', sensitivity: 'internal' }),
    ];
    const filtered = filter.filterResults(results);
    expect(filtered).toHaveLength(2);  // a and c pass, b denied
    expect(filtered.map(r => r.id)).toEqual(['a', 'c']);
  });
});
```

- [ ] **Step 2: Implement access filter**

```typescript
// src/lib/cortex/boundary/access.ts
import type { ScoredKnowledge, Scope, ScopeLevel, SensitivityClass } from '../knowledge/types';

const SCOPE_HIERARCHY: Record<ScopeLevel, number> = {
  personal: 0,
  team: 1,
  department: 2,
  organization: 3,
};

export interface AccessFilterConfig {
  requesterId: string;
  requesterScope: Scope;        // requester's team scope
  requesterOrg: string;         // requester's org entity_id
  grants?: Set<string>;         // knowledge IDs the requester has been granted access to
}

export class AccessFilter {
  private config: AccessFilterConfig;

  constructor(config: AccessFilterConfig) {
    this.config = config;
  }

  canAccess(unit: ScoredKnowledge): boolean {
    const sensitivity = (unit.sensitivity ?? 'internal') as SensitivityClass;
    const unitScope = unit.scope ?? { level: 'personal' as ScopeLevel, entity_id: '' };
    const creatorId = unit.origin?.creator_entity_id ?? '';

    // Check creator_scope override first — most restrictive wins
    if (unit.creator_scope) {
      const maxLevel = SCOPE_HIERARCHY[unit.creator_scope.max_level] ?? 0;
      const requesterLevel = this.getRequesterProximityLevel(unitScope);
      if (requesterLevel > maxLevel) return false;
    }

    switch (sensitivity) {
      case 'public':
        return true;

      case 'internal':
        // Accessible to anyone in the same org
        return true;

      case 'restricted':
        // Accessible within same scope or if policy grants cross-scope access
        return this.isWithinScope(unitScope);

      case 'confidential':
        // Only creator or explicit grant
        if (this.config.requesterId === creatorId) return true;
        if (this.config.grants?.has(unit.id)) return true;
        return false;

      default:
        return false;
    }
  }

  filterResults(results: ScoredKnowledge[]): ScoredKnowledge[] {
    return results.filter(r => this.canAccess(r));
  }

  private isWithinScope(unitScope: Scope): boolean {
    // Same entity_id = same scope
    if (unitScope.entity_id === this.config.requesterScope.entity_id) return true;
    if (unitScope.entity_id === this.config.requesterId) return true;
    // Same org for org-level scopes
    if (unitScope.level === 'organization' && unitScope.entity_id === this.config.requesterOrg) return true;
    return false;
  }

  private getRequesterProximityLevel(unitScope: Scope): number {
    // How "far" is the requester from the unit's scope?
    // 0 = same entity, 1 = same scope level, 2+ = further
    if (unitScope.entity_id === this.config.requesterId) return 0;
    if (unitScope.entity_id === this.config.requesterScope.entity_id) return 0;
    return SCOPE_HIERARCHY[unitScope.level] ?? 3;
  }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(cortex): add query-time access filter for boundary enforcement"
```

---

### Task 4: Audit trail

**Files:**
- Create: `src/lib/cortex/boundary/audit.ts`
- Create: `tests/lib/cortex/boundary/audit.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/lib/cortex/boundary/audit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { AuditLog } from '@/lib/cortex/boundary/audit';

describe('AuditLog', () => {
  let tmpDir: string;
  let audit: AuditLog;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-audit-'));
    const db = new Database(path.join(tmpDir, 'graph.db'));
    audit = new AuditLog(db);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('logs an access decision', () => {
    audit.log({
      requesterId: 'person-alice',
      knowledgeId: 'k1',
      action: 'allowed',
      reason: 'public sensitivity',
    });
    const entries = audit.query({ requesterId: 'person-alice' });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('allowed');
  });

  it('logs denied access', () => {
    audit.log({
      requesterId: 'person-alice',
      knowledgeId: 'k2',
      action: 'denied',
      reason: 'confidential, not creator',
    });
    const entries = audit.query({ requesterId: 'person-alice' });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('denied');
  });

  it('queries by time range', () => {
    audit.log({ requesterId: 'person-alice', knowledgeId: 'k1', action: 'allowed', reason: 'public' });
    const recent = audit.query({ since: new Date(Date.now() - 60000).toISOString() });
    expect(recent).toHaveLength(1);

    const future = audit.query({ since: new Date(Date.now() + 60000).toISOString() });
    expect(future).toHaveLength(0);
  });

  it('supports retention cleanup', () => {
    audit.log({ requesterId: 'person-alice', knowledgeId: 'k1', action: 'allowed', reason: 'test' });
    // Cleanup entries older than 0 days (everything)
    audit.cleanup(0);
    const entries = audit.query({});
    expect(entries).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement audit log**

```typescript
// src/lib/cortex/boundary/audit.ts
import type Database from 'better-sqlite3';

export interface AuditEntry {
  requesterId: string;
  knowledgeId: string;
  action: 'allowed' | 'denied';
  reason: string;
}

export interface AuditQueryFilter {
  requesterId?: string;
  since?: string;  // ISO timestamp
  limit?: number;
}

export interface AuditRecord extends AuditEntry {
  timestamp: string;
}

export class AuditLog {
  private db: InstanceType<typeof Database>;

  constructor(db: InstanceType<typeof Database>) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        requester_id TEXT NOT NULL,
        knowledge_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_requester ON audit_log(requester_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
    `);
  }

  log(entry: AuditEntry): void {
    this.db.prepare(`
      INSERT INTO audit_log (requester_id, knowledge_id, action, reason, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(entry.requesterId, entry.knowledgeId, entry.action, entry.reason, new Date().toISOString());
  }

  query(filter: AuditQueryFilter): AuditRecord[] {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params: any[] = [];

    if (filter.requesterId) {
      sql += ' AND requester_id = ?';
      params.push(filter.requesterId);
    }
    if (filter.since) {
      sql += ' AND timestamp >= ?';
      params.push(filter.since);
    }

    sql += ' ORDER BY timestamp DESC';

    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    return (this.db.prepare(sql).all(...params) as any[]).map(row => ({
      requesterId: row.requester_id,
      knowledgeId: row.knowledge_id,
      action: row.action,
      reason: row.reason,
      timestamp: row.timestamp,
    }));
  }

  cleanup(retentionDays: number): void {
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    this.db.prepare('DELETE FROM audit_log WHERE timestamp < ?').run(cutoff);
  }
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat(cortex): add audit trail for access decisions"
```

---

## Chunk 3: Integration

### Task 5: Integrate with ingestion pipeline

**Files:**
- Modify: `src/lib/cortex/ingestion/pipeline.ts`

- [ ] **Step 1: Read pipeline.ts**

- [ ] **Step 2: Add auto-classification during ingestion**

Import the classifier:
```typescript
import { classifySensitivity } from '../boundary/classifier';
```

In the KnowledgeUnit construction (where v2 fields are set), replace the hardcoded `sensitivity: 'internal'` with:
```typescript
sensitivity: classifySensitivity(chunk.text),
```

This ensures every ingested knowledge unit gets an auto-classified sensitivity level.

- [ ] **Step 3: Run pipeline tests to verify no regressions**

```bash
npx vitest run tests/lib/cortex/ingestion/
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cortex): auto-classify sensitivity during ingestion"
```

---

### Task 6: Integrate AccessFilter with ContextEngine

**Files:**
- Modify: `src/lib/cortex/retrieval/context-engine.ts`

- [ ] **Step 1: Read context-engine.ts**

- [ ] **Step 2: Add AccessFilter to the pipeline**

Import AccessFilter:
```typescript
import { AccessFilter } from '../boundary/access';
```

Add to `ContextEngineDeps`:
```typescript
accessFilter?: AccessFilter;
```

In the `assemble()` method, after fusion/ranking (Stage 5) but before conflict detection (Stage 6), apply the access filter:

```typescript
// Stage 5.5: Access control filtering
let accessible = fused;
if (this.deps.accessFilter) {
  accessible = this.deps.accessFilter.filterResults(fused);
}
```

Then pass `accessible` (not `fused`) to conflict detection and formatting.

- [ ] **Step 3: Run context-engine tests to verify no regressions**

```bash
npx vitest run tests/lib/cortex/retrieval/context-engine.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cortex): integrate access filter into context assembly pipeline"
```

---

### Task 7: Barrel export and config integration

**Files:**
- Create: `src/lib/cortex/boundary/index.ts`
- Modify: `src/lib/cortex/config.ts` (add policies array to config)

- [ ] **Step 1: Create barrel export**

```typescript
// src/lib/cortex/boundary/index.ts
export { classifySensitivity } from './classifier';
export { PolicyEngine } from './policy';
export type { Policy, PolicyAction, PropagationTarget } from './policy';
export { AccessFilter } from './access';
export type { AccessFilterConfig } from './access';
export { AuditLog } from './audit';
export type { AuditEntry, AuditRecord, AuditQueryFilter } from './audit';
```

- [ ] **Step 2: Add policies to CortexConfig**

In `src/lib/cortex/config.ts`, add to the `CortexConfig` interface:
```typescript
policies?: Policy[];  // Organizational boundary policies
```

And in `DEFAULT_CORTEX_CONFIG`:
```typescript
policies: [],
```

Import the Policy type:
```typescript
import type { Policy } from './boundary/policy';
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run tests/lib/cortex/
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(cortex): add boundary module barrel export and config integration"
```

---

## Summary

| Task | Component | Tests | Status |
|------|-----------|-------|--------|
| 1 | Sensitivity classifier | 7 | |
| 2 | Policy engine | 6 | |
| 3 | Access filter | 8 | |
| 4 | Audit trail | 4 | |
| 5 | Pipeline integration | regression | |
| 6 | ContextEngine integration | regression | |
| 7 | Barrel export + config | regression | |

**Total: 7 tasks, ~25 new tests, 3 chunks**

**Key design decisions:**
- Auto-classification is regex-based (no LLM call) — fast, deterministic, auditable
- Policies are stored in CortexConfig (admin-editable JSON) — not code
- AccessFilter is a separate class that can be composed with ContextEngine or used standalone
- Audit log uses the entity graph's SQLite DB (same file, new table) — no new database
- Most restrictive classification always wins (confidential > restricted > internal > public)
