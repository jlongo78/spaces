import { describe, it, expect } from 'vitest';
import { AccessFilter } from '@/lib/cortex/boundary/access';
import type { ScoredKnowledge, Scope, SensitivityClass } from '@/lib/cortex/knowledge/types';

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeUnit(overrides: Partial<ScoredKnowledge> & { id: string }): ScoredKnowledge {
  return {
    // ScoredKnowledge required fields
    relevance_score: 0.9,
    similarity: 0.9,
    // KnowledgeUnit required fields
    vector: [],
    text: 'test knowledge',
    type: 'decision',
    layer: 'team',
    workspace_id: null,
    session_id: null,
    agent_type: 'claude',
    project_path: null,
    file_refs: [],
    confidence: 0.8,
    created: '2024-01-01T00:00:00Z',
    source_timestamp: '2024-01-01T00:00:00Z',
    stale_score: 0,
    access_count: 0,
    last_accessed: null,
    metadata: {},
    // optional v2 fields defaulted to undefined
    scope: undefined,
    sensitivity: undefined,
    origin: undefined,
    creator_scope: undefined,
    ...overrides,
  };
}

// ─── Filter setup ─────────────────────────────────────────────────────────────

const REQUESTER_SCOPE: Scope = { level: 'team', entity_id: 'team-platform' };

const filter = new AccessFilter({
  requesterId: 'person-alice',
  requesterScope: REQUESTER_SCOPE,
  requesterOrg: 'organization-acme',
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AccessFilter', () => {
  it('allows public knowledge from anywhere in org', () => {
    const unit = makeUnit({
      id: 'k-public',
      sensitivity: 'public',
      scope: { level: 'organization', entity_id: 'organization-acme' },
    });
    expect(filter.canAccess(unit)).toBe(true);
  });

  it('allows internal knowledge within org', () => {
    const unit = makeUnit({
      id: 'k-internal',
      sensitivity: 'internal',
      scope: { level: 'team', entity_id: 'team-backend' },
    });
    expect(filter.canAccess(unit)).toBe(true);
  });

  it('allows restricted knowledge within same scope (team-platform)', () => {
    const unit = makeUnit({
      id: 'k-restricted-same',
      sensitivity: 'restricted',
      scope: { level: 'team', entity_id: 'team-platform' },
    });
    expect(filter.canAccess(unit)).toBe(true);
  });

  it('denies restricted knowledge from different department', () => {
    const unit = makeUnit({
      id: 'k-restricted-other',
      sensitivity: 'restricted',
      scope: { level: 'department', entity_id: 'department-sales' },
    });
    expect(filter.canAccess(unit)).toBe(false);
  });

  it('allows confidential knowledge from self (creator = person-alice)', () => {
    const unit = makeUnit({
      id: 'k-confidential-self',
      sensitivity: 'confidential',
      origin: {
        source_type: 'conversation',
        source_ref: 'sess-1',
        creator_entity_id: 'person-alice',
      },
    });
    expect(filter.canAccess(unit)).toBe(true);
  });

  it('denies confidential knowledge from others (creator = person-bob)', () => {
    const unit = makeUnit({
      id: 'k-confidential-other',
      sensitivity: 'confidential',
      origin: {
        source_type: 'conversation',
        source_ref: 'sess-2',
        creator_entity_id: 'person-bob',
      },
    });
    expect(filter.canAccess(unit)).toBe(false);
  });

  it('respects creator_scope override (internal + creator_scope max_level: personal → denied for non-creator)', () => {
    // max_level: personal means only the creator (personal scope) may see it
    const unit = makeUnit({
      id: 'k-creator-scope',
      sensitivity: 'internal',
      creator_scope: { max_level: 'personal' },
      origin: {
        source_type: 'conversation',
        source_ref: 'sess-3',
        creator_entity_id: 'person-bob', // different person
      },
    });
    // Alice's scope level is 'team', which is broader than 'personal', and
    // she is not the creator → should be denied by the override.
    expect(filter.canAccess(unit)).toBe(false);
  });

  it('filters a list of results (3 in → 2 out)', () => {
    const units: ScoredKnowledge[] = [
      // allowed: public
      makeUnit({ id: 'k-1', sensitivity: 'public' }),
      // allowed: restricted, same scope
      makeUnit({
        id: 'k-2',
        sensitivity: 'restricted',
        scope: { level: 'team', entity_id: 'team-platform' },
      }),
      // denied: confidential, created by someone else, no grant
      makeUnit({
        id: 'k-3',
        sensitivity: 'confidential',
        origin: {
          source_type: 'conversation',
          source_ref: 'sess-4',
          creator_entity_id: 'person-charlie',
        },
      }),
    ];

    const result = filter.filterResults(units);
    expect(result).toHaveLength(2);
    expect(result.map((u) => u.id)).toEqual(['k-1', 'k-2']);
  });
});
