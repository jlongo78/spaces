import { describe, it, expect } from 'vitest';
import { computeRelevanceScore, computeRecencyBoost, computeStaleScore } from '@/lib/cortex/retrieval/scoring';

describe('scoring', () => {
  it('computes relevance score correctly', () => {
    const score = computeRelevanceScore({
      similarity: 0.9,
      confidence: 0.8,
      stale_score: 0.1,
      created: new Date().toISOString(),
    });
    expect(score).toBeGreaterThan(0.6);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('recency boost is higher for recent items', () => {
    const recent = computeRecencyBoost(new Date().toISOString());
    const old = computeRecencyBoost(new Date(Date.now() - 30 * 86400000).toISOString());
    expect(recent).toBeGreaterThan(old);
  });

  it('stale score increases with time based on halflife', () => {
    const fresh = computeStaleScore(new Date().toISOString(), 90);
    const stale = computeStaleScore(
      new Date(Date.now() - 180 * 86400000).toISOString(), 90
    );
    expect(fresh).toBeLessThan(0.1);
    expect(stale).toBeGreaterThan(0.5);
  });
});
