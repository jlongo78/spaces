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
