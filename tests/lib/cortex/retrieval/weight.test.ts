import { describe, it, expect } from 'vitest';
import { computeScopeWeight, computeTypeBoost, computeAuthority } from '@/lib/cortex/retrieval/weight';
import type { IntentBiases } from '@/lib/cortex/retrieval/intent';

const neutralBiases: IntentBiases = {
  scope_boost: { personal: 1.0, team: 1.0, department: 1.0, organization: 1.0 },
  type_boost: {},
  recency_boost: 1.0,
};

const debugBiases: IntentBiases = {
  scope_boost: { personal: 1.2, team: 0.8, department: 0.6, organization: 0.5 },
  type_boost: { error_fix: 1.5 },
  recency_boost: 1.3,
};

describe('computeScopeWeight', () => {
  it('returns 1.0 for self (graphProximity=1.0, neutral biases, authority=1.0)', () => {
    const result = computeScopeWeight({
      graphProximity: 1.0,
      scopeLevel: 'personal',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    expect(result).toBe(1.0);
  });

  it('decreases with graph distance (0.5 proximity > 0.25 proximity)', () => {
    const high = computeScopeWeight({
      graphProximity: 0.5,
      scopeLevel: 'personal',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    const low = computeScopeWeight({
      graphProximity: 0.25,
      scopeLevel: 'personal',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    expect(high).toBeGreaterThan(low);
  });

  it('is boosted by intent biases (debug personal=1.2 > team=0.8)', () => {
    const personal = computeScopeWeight({
      graphProximity: 1.0,
      scopeLevel: 'personal',
      intentBiases: debugBiases,
      authorityFactor: 1.0,
    });
    const team = computeScopeWeight({
      graphProximity: 1.0,
      scopeLevel: 'team',
      intentBiases: debugBiases,
      authorityFactor: 1.0,
    });
    expect(personal).toBeGreaterThan(team);
    expect(personal).toBeCloseTo(1.2);
    expect(team).toBeCloseTo(0.8);
  });

  it('is boosted by authority factor (1.2 > 1.0)', () => {
    const boosted = computeScopeWeight({
      graphProximity: 1.0,
      scopeLevel: 'personal',
      intentBiases: neutralBiases,
      authorityFactor: 1.2,
    });
    const baseline = computeScopeWeight({
      graphProximity: 1.0,
      scopeLevel: 'personal',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    expect(boosted).toBeGreaterThan(baseline);
  });

  it('never returns negative (graphProximity=0)', () => {
    const result = computeScopeWeight({
      graphProximity: 0,
      scopeLevel: 'personal',
      intentBiases: neutralBiases,
      authorityFactor: 1.0,
    });
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

describe('computeTypeBoost', () => {
  it('returns the mapped boost for a known type', () => {
    expect(computeTypeBoost('error_fix', debugBiases)).toBe(1.5);
  });

  it('returns 1.0 for an unknown type', () => {
    expect(computeTypeBoost('unknown_type', debugBiases)).toBe(1.0);
  });
});

describe('computeAuthority', () => {
  it('sums role_boost and expertise_weight', () => {
    const result = computeAuthority({ role_boost: 0.5, expertise_weight: 0.5 });
    expect(result).toBe(1.0);
  });

  it('applies 1.2 boost for document source type', () => {
    const doc = computeAuthority({ role_boost: 0.5, expertise_weight: 0.5, source_type: 'document' });
    const nonDoc = computeAuthority({ role_boost: 0.5, expertise_weight: 0.5 });
    expect(doc).toBeCloseTo(nonDoc * 1.2);
  });
});
