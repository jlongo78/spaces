import { describe, it, expect } from 'vitest';
import {
  PROMOTION_TYPE_WEIGHTS,
  HOP_DECAY,
  computePromotionScore,
  shouldPromote,
  getNextLevel,
} from '@/lib/cortex/gravity/promotion';

describe('computePromotionScore', () => {
  it('computes score from evidence, type weight, and freshness — decision at 10 days caps at 1.0', () => {
    // decision weight=1.5, freshness=1.0 (≤30 days), evidenceScore=0.9 → 0.9*1.5*1.0=1.35 → capped at 1.0
    const score = computePromotionScore({
      evidenceScore: 0.9,
      type: 'decision',
      createdDaysAgo: 10,
    });
    expect(score).toBe(1.0);
  });

  it('applies type weights correctly — decision scores higher than conversation', () => {
    const decisionScore = computePromotionScore({
      evidenceScore: 0.5,
      type: 'decision',
      createdDaysAgo: 10,
    });
    const conversationScore = computePromotionScore({
      evidenceScore: 0.5,
      type: 'conversation',
      createdDaysAgo: 10,
    });
    expect(decisionScore).toBeGreaterThan(conversationScore);
    expect(PROMOTION_TYPE_WEIGHTS.decision).toBe(1.5);
    expect(PROMOTION_TYPE_WEIGHTS.conversation).toBe(0.5);
  });

  it('decays with age — 5 days produces higher score than 120 days', () => {
    const fresh = computePromotionScore({
      evidenceScore: 0.6,
      type: 'pattern',
      createdDaysAgo: 5,
    });
    const stale = computePromotionScore({
      evidenceScore: 0.6,
      type: 'pattern',
      createdDaysAgo: 120,
    });
    // fresh: 0.6*1.2*1.0=0.72; stale: 0.6*1.2*0.5=0.36
    expect(fresh).toBeGreaterThan(stale);
    expect(fresh).toBeCloseTo(0.72, 5);
    expect(stale).toBeCloseTo(0.36, 5);
  });
});

describe('shouldPromote', () => {
  it('promotes personal→team when score and corroborations meet threshold', () => {
    const result = shouldPromote({
      currentLevel: 'personal',
      promotionScore: 0.7,
      corroborations: 3,
      sensitivity: 'internal',
      hasContradictions: false,
    });
    expect(result).toBe(true);
  });

  it('blocks promotion when sensitivity is restricted', () => {
    const result = shouldPromote({
      currentLevel: 'personal',
      promotionScore: 0.9,
      corroborations: 5,
      sensitivity: 'restricted',
      hasContradictions: false,
    });
    expect(result).toBe(false);
  });

  it('blocks when corroborations are insufficient for personal→team', () => {
    const result = shouldPromote({
      currentLevel: 'personal',
      promotionScore: 0.8,
      corroborations: 1,
      sensitivity: 'public',
      hasContradictions: false,
    });
    expect(result).toBe(false);
  });

  it('blocks dept→org when contradictions exist', () => {
    const result = shouldPromote({
      currentLevel: 'department',
      promotionScore: 0.95,
      corroborations: 6,
      sensitivity: 'public',
      hasContradictions: true,
    });
    expect(result).toBe(false);
  });

  it('requires higher thresholds for higher promotions — 0.65 passes personal→team but not team→dept', () => {
    const personalToTeam = shouldPromote({
      currentLevel: 'personal',
      promotionScore: 0.65,
      corroborations: 3,
      sensitivity: 'public',
      hasContradictions: false,
    });
    const teamToDept = shouldPromote({
      currentLevel: 'team',
      promotionScore: 0.65,
      corroborations: 3,
      sensitivity: 'public',
      hasContradictions: false,
    });
    expect(personalToTeam).toBe(true);
    expect(teamToDept).toBe(false);
  });
});

describe('getNextLevel', () => {
  it('returns the next scope level in promotion chain', () => {
    expect(getNextLevel('personal')).toBe('team');
    expect(getNextLevel('team')).toBe('department');
    expect(getNextLevel('department')).toBe('organization');
  });

  it('returns null for organization (top level)', () => {
    expect(getNextLevel('organization')).toBeNull();
  });
});

describe('HOP_DECAY', () => {
  it('exports HOP_DECAY constant as 0.85', () => {
    expect(HOP_DECAY).toBe(0.85);
  });
});
