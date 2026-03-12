import { describe, it, expect } from 'vitest';
import { cosineSimilarity, isDuplicate } from '@/lib/cortex/ingestion/deduplicator';

describe('deduplicator', () => {
  it('computes cosine similarity correctly', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0);

    const c = [0, 1, 0];
    expect(cosineSimilarity(a, c)).toBeCloseTo(0.0);
  });

  it('detects duplicates above threshold', () => {
    const v1 = [0.9, 0.1, 0.0];
    const v2 = [0.89, 0.11, 0.01];
    expect(isDuplicate(v1, v2, 0.95)).toBe(true);

    const v3 = [0.0, 1.0, 0.0];
    expect(isDuplicate(v1, v3, 0.95)).toBe(false);
  });
});
