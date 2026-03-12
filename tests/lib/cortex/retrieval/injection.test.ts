import { describe, it, expect } from 'vitest';
import { formatCortexContext } from '@/lib/cortex/retrieval/injection';
import type { ScoredKnowledge } from '@/lib/cortex/knowledge/types';

describe('formatCortexContext', () => {
  const makeUnit = (overrides: Partial<ScoredKnowledge> = {}): ScoredKnowledge => ({
    id: 'test-1',
    vector: [],
    text: 'Use JWT for auth',
    type: 'decision',
    layer: 'workspace',
    workspace_id: 1,
    session_id: 'sess-1',
    agent_type: 'claude',
    project_path: '/project',
    file_refs: [],
    confidence: 0.85,
    created: '2026-03-10T00:00:00Z',
    source_timestamp: '2026-03-10T00:00:00Z',
    stale_score: 0,
    access_count: 0,
    last_accessed: null,
    metadata: {},
    relevance_score: 0.9,
    similarity: 0.92,
    ...overrides,
  });

  it('returns empty string for no results', () => {
    expect(formatCortexContext([])).toBe('');
  });

  it('wraps results in cortex-context tags', () => {
    const result = formatCortexContext([makeUnit()]);
    expect(result).toContain('<cortex-context>');
    expect(result).toContain('</cortex-context>');
    expect(result).toContain('[Decision]');
    expect(result).toContain('Use JWT for auth');
  });

  it('respects token budget', () => {
    const units = Array.from({ length: 50 }, (_, i) =>
      makeUnit({ id: `u-${i}`, text: 'A'.repeat(200) })
    );
    const result = formatCortexContext(units, 500);
    const entryCount = (result.match(/\[Decision\]/g) || []).length;
    expect(entryCount).toBeLessThan(50);
  });

  it('formats different knowledge types correctly', () => {
    const result = formatCortexContext([
      makeUnit({ type: 'preference', text: 'No ORMs' }),
      makeUnit({ type: 'error_fix', text: 'Fix ECONNRESET' }),
    ]);
    expect(result).toContain('[Preference]');
    expect(result).toContain('[Error Fix]');
  });
});
