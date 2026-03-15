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
    const results = [
      makeResult({ id: 'a', contradiction_refs: [] }),
      makeResult({ id: 'b', contradiction_refs: [] }),
    ];
    expect(detectConflicts(results)).toEqual([]);
  });

  it('detects conflict between two results', () => {
    const a = makeResult({ id: 'a', contradiction_refs: ['b'] });
    const b = makeResult({ id: 'b', contradiction_refs: ['a'] });
    const conflicts = detectConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    const ids = [conflicts[0].unitA.id, conflicts[0].unitB.id].sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('ignores contradiction_refs pointing to results not in the set', () => {
    const a = makeResult({ id: 'a', contradiction_refs: ['z'] }); // z not in set
    const b = makeResult({ id: 'b', contradiction_refs: [] });
    expect(detectConflicts([a, b])).toHaveLength(0);
  });

  it('deduplicates symmetric conflicts', () => {
    const a = makeResult({ id: 'a', contradiction_refs: ['b'] });
    const b = makeResult({ id: 'b', contradiction_refs: ['a'] });
    const conflicts = detectConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
  });
});
