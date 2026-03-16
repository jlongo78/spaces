import { describe, it, expect } from 'vitest';
import { formatContext } from '@/lib/cortex/retrieval/formatter';
import type { ScoredKnowledge } from '@/lib/cortex/knowledge/types';
import type { ConflictPair } from '@/lib/cortex/retrieval/conflict';

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

describe('formatContext', () => {
  it('wraps results in cortex-context tags', () => {
    const result = formatContext([makeResult()], []);
    expect(result).toContain('<cortex-context>');
    expect(result).toContain('</cortex-context>');
  });

  it('includes type labels and dates', () => {
    const unit = makeResult({
      type: 'error_fix',
      source_timestamp: '2026-01-15T10:00:00Z',
      text: 'Fixed the auth bug',
    });
    const result = formatContext([unit], []);
    expect(result).toContain('[Error Fix]');
    expect(result).toContain('2026-01-15');
  });

  it('includes source attribution when origin is present', () => {
    const unit = makeResult({
      origin: {
        source_type: 'conversation',
        source_ref: 'conv-123',
        creator_entity_id: 'alice',
      },
    });
    const result = formatContext([unit], []);
    expect(result).toContain('alice');
  });

  it('includes conflict callout when conflicts exist', () => {
    const a = makeResult({ id: 'a', text: 'Use Postgres' });
    const b = makeResult({ id: 'b', text: 'Use SQLite' });
    const conflicts: ConflictPair[] = [{ unitA: a, unitB: b }];
    const result = formatContext([a, b], conflicts);
    expect(result).toContain('Conflicting');
  });

  it('respects max token budget', () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      makeResult({ id: `u-${i}`, text: 'A'.repeat(500) }),
    );
    const result = formatContext(results, [], { maxTokens: 500 });
    expect(result.length).toBeLessThan(3000);
  });

  it('returns empty string when no results', () => {
    expect(formatContext([], [])).toBe('');
  });
});
