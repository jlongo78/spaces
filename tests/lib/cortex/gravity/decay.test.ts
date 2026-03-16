import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_THRESHOLD,
  computeDecay,
  shouldArchive,
} from '@/lib/cortex/gravity/decay';

describe('computeDecay', () => {
  it('returns 0 for recently accessed units (5 days)', () => {
    const decay = computeDecay({ daysSinceAccess: 5, currentEvidenceScore: 0.8 });
    expect(decay).toBe(0);
  });

  it('returns small decay for moderately old units (60 days)', () => {
    // ((60 - 30) / 365) * 0.2 ≈ 0.01644
    const decay = computeDecay({ daysSinceAccess: 60, currentEvidenceScore: 0.8 });
    expect(decay).toBeGreaterThan(0);
    expect(decay).toBeCloseTo(((60 - 30) / 365) * 0.2, 5);
  });

  it('returns larger decay for very old units — 180 days decays more than 60 days', () => {
    const decay60  = computeDecay({ daysSinceAccess: 60,  currentEvidenceScore: 0.8 });
    const decay180 = computeDecay({ daysSinceAccess: 180, currentEvidenceScore: 0.8 });
    expect(decay180).toBeGreaterThan(decay60);
  });

  it('never makes evidence score negative — 365 days at score 0.1 caps decay at 0.1', () => {
    const decay = computeDecay({ daysSinceAccess: 365, currentEvidenceScore: 0.1 });
    expect(decay).toBeLessThanOrEqual(0.1);
  });
});

describe('shouldArchive', () => {
  it('archives when evidence < 0.1 and age ≥ 200 days', () => {
    expect(shouldArchive({ evidenceScore: 0.05, daysSinceCreated: 200 })).toBe(true);
  });

  it('does not archive recent units (30 days) even with low evidence', () => {
    expect(shouldArchive({ evidenceScore: 0.05, daysSinceCreated: 30 })).toBe(false);
  });

  it('does not archive units above threshold (0.5 at 200 days)', () => {
    expect(shouldArchive({ evidenceScore: 0.5, daysSinceCreated: 200 })).toBe(false);
  });

  it('ARCHIVE_THRESHOLD is 0.1', () => {
    expect(ARCHIVE_THRESHOLD).toBe(0.1);
  });
});
