import { describe, it, expect } from 'vitest';
import { computeFileStaleScore, computeTimeDecay } from '@/lib/cortex/knowledge/staleness';

describe('staleness', () => {
  it('returns 0 for recently created knowledge with no file changes', () => {
    const now = new Date().toISOString();
    const score = computeFileStaleScore({
      fileRefs: ['src/auth.ts'],
      sourceTimestamp: now,
      fileModTimes: { 'src/auth.ts': now },
    });
    expect(score).toBeCloseTo(0, 5);
  });

  it('returns >0 when referenced file was modified after knowledge creation', () => {
    const created = new Date('2026-01-01').toISOString();
    const modified = new Date('2026-03-10').toISOString();
    const score = computeFileStaleScore({
      fileRefs: ['src/auth.ts'],
      sourceTimestamp: created,
      fileModTimes: { 'src/auth.ts': modified },
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0 when no file refs', () => {
    const score = computeFileStaleScore({
      fileRefs: [],
      sourceTimestamp: new Date().toISOString(),
      fileModTimes: {},
    });
    expect(score).toBe(0);
  });

  it('computes time decay with halflife', () => {
    const now = Date.now();
    const halflifeDays = 90;
    const created = new Date(now - halflifeDays * 24 * 60 * 60 * 1000).toISOString();
    const decay = computeTimeDecay(created, halflifeDays);
    expect(decay).toBeCloseTo(0.5, 1);
  });

  it('returns ~1 for very old knowledge', () => {
    const created = new Date('2020-01-01').toISOString();
    const decay = computeTimeDecay(created, 30);
    expect(decay).toBeGreaterThan(0.95);
  });

  it('returns ~0 for very recent knowledge', () => {
    const decay = computeTimeDecay(new Date().toISOString(), 180);
    expect(decay).toBeCloseTo(0, 1);
  });
});
