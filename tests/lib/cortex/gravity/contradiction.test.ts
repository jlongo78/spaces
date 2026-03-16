import { describe, it, expect } from 'vitest';
import {
  detectSentimentConflict,
  CONTRADICTION_COSINE_THRESHOLD,
  DEDUP_COSINE_THRESHOLD,
} from '@/lib/cortex/gravity/contradiction';

describe('detectSentimentConflict', () => {
  it('detects opposing sentiments — increase pool size vs do NOT increase pool size, scale horizontally', () => {
    const textA = 'increase pool size';
    const textB = 'do NOT increase pool size, scale horizontally';
    expect(detectSentimentConflict(textA, textB)).toBe(true);
  });

  it('returns false for agreeing statements — use PostgreSQL vs PostgreSQL is the right choice', () => {
    const textA = 'use PostgreSQL';
    const textB = 'PostgreSQL is the right choice';
    expect(detectSentimentConflict(textA, textB)).toBe(false);
  });

  it('detects negation patterns — should use Redis vs should not use Redis', () => {
    const textA = 'should use Redis';
    const textB = 'should not use Redis';
    expect(detectSentimentConflict(textA, textB)).toBe(true);
  });

  it('detects replacement patterns — use Express vs use Fastify instead of Express', () => {
    const textA = 'use Express';
    const textB = 'use Fastify instead of Express';
    expect(detectSentimentConflict(textA, textB)).toBe(true);
  });

  it('returns false for unrelated statements — auth handles JWT vs deploy on Fridays', () => {
    const textA = 'auth handles JWT';
    const textB = 'deploy on Fridays';
    expect(detectSentimentConflict(textA, textB)).toBe(false);
  });
});

describe('contradiction constants', () => {
  it('exports CONTRADICTION_COSINE_THRESHOLD as 0.80', () => {
    expect(CONTRADICTION_COSINE_THRESHOLD).toBe(0.80);
  });

  it('exports DEDUP_COSINE_THRESHOLD as 0.90', () => {
    expect(DEDUP_COSINE_THRESHOLD).toBe(0.90);
  });
});
