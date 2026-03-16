import { describe, it, expect } from 'vitest';
import { computeEvidenceScore, AUTHORITY_FACTORS } from '@/lib/cortex/knowledge/evidence';

describe('computeEvidenceScore', () => {
  it('returns base confidence for fresh unit with no interactions', () => {
    const score = computeEvidenceScore({
      baseConfidence: 0.8,
      corroborations: 0,
      accessCount: 0,
      authorityFactor: AUTHORITY_FACTORS.conversation,
      contradictionCount: 0,
    });
    // corroborationBoost=1, accessBoost=1, contradictionPenalty=1, authorityFactor=1.0 → raw=0.8
    expect(score).toBeCloseTo(0.8, 5);
  });

  it('increases with corroborations', () => {
    const noCorroboration = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 0,
      accessCount: 0,
      authorityFactor: 1.0,
      contradictionCount: 0,
    });
    const withCorroboration = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 3,
      accessCount: 0,
      authorityFactor: 1.0,
      contradictionCount: 0,
    });
    expect(withCorroboration).toBeGreaterThan(noCorroboration);
  });

  it('increases with access count (diminishing returns)', () => {
    const low = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 0,
      accessCount: 5,
      authorityFactor: 1.0,
      contradictionCount: 0,
    });
    const high = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 0,
      accessCount: 50,
      authorityFactor: 1.0,
      contradictionCount: 0,
    });
    const capped = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 0,
      accessCount: 100,
      authorityFactor: 1.0,
      contradictionCount: 0,
    });
    expect(high).toBeGreaterThan(low);
    // accessCount is capped at 50, so 100 and 50 produce identical scores
    expect(capped).toBeCloseTo(high, 10);
  });

  it('decreases with contradictions', () => {
    const noContradictions = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 0,
      accessCount: 0,
      authorityFactor: 1.0,
      contradictionCount: 0,
    });
    const withContradictions = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 0,
      accessCount: 0,
      authorityFactor: 1.0,
      contradictionCount: 2,
    });
    expect(withContradictions).toBeLessThan(noContradictions);
  });

  it('caps corroboration contribution at 10', () => {
    const atTen = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 10,
      accessCount: 0,
      authorityFactor: 1.0,
      contradictionCount: 0,
    });
    const atTwenty = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 20,
      accessCount: 0,
      authorityFactor: 1.0,
      contradictionCount: 0,
    });
    expect(atTwenty).toBeCloseTo(atTen, 10);
  });

  it('is boosted by authority factor', () => {
    const conversationScore = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 0,
      accessCount: 0,
      authorityFactor: AUTHORITY_FACTORS.conversation,
      contradictionCount: 0,
    });
    const documentScore = computeEvidenceScore({
      baseConfidence: 0.5,
      corroborations: 0,
      accessCount: 0,
      authorityFactor: AUTHORITY_FACTORS.document,
      contradictionCount: 0,
    });
    expect(documentScore).toBeGreaterThan(conversationScore);
  });

  it('is capped at 1.0', () => {
    const score = computeEvidenceScore({
      baseConfidence: 1.0,
      corroborations: 100,
      accessCount: 1000,
      authorityFactor: 10.0,
      contradictionCount: 0,
    });
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('never goes below 0', () => {
    const score = computeEvidenceScore({
      baseConfidence: 0.0,
      corroborations: 0,
      accessCount: 0,
      authorityFactor: 1.0,
      contradictionCount: 1000,
    });
    expect(score).toBeGreaterThanOrEqual(0);
  });
});
