import { describe, it, expect } from 'vitest';
import {
  KNOWLEDGE_TYPES,
  LAYERS,
  type KnowledgeUnit,
  type KnowledgeType,
  type Layer,
  type ProvenanceChain,
  isValidKnowledgeType,
  isValidLayer,
  getConfidenceBase,
  getHalflifeDays,
} from '@/lib/cortex/knowledge/types';

describe('knowledge types', () => {
  it('defines all 9 knowledge types', () => {
    expect(KNOWLEDGE_TYPES).toHaveLength(9);
    expect(KNOWLEDGE_TYPES).toContain('decision');
    expect(KNOWLEDGE_TYPES).toContain('preference');
    expect(KNOWLEDGE_TYPES).toContain('error_fix');
    expect(KNOWLEDGE_TYPES).toContain('conversation');
  });

  it('defines 3 layers', () => {
    expect(LAYERS).toEqual(['personal', 'workspace', 'team']);
  });

  it('validates knowledge types', () => {
    expect(isValidKnowledgeType('decision')).toBe(true);
    expect(isValidKnowledgeType('invalid')).toBe(false);
  });

  it('validates layers', () => {
    expect(isValidLayer('personal')).toBe(true);
    expect(isValidLayer('federation')).toBe(false);
  });

  it('returns correct confidence base per type', () => {
    expect(getConfidenceBase('decision')).toBe(0.8);
    expect(getConfidenceBase('preference')).toBe(0.95);
    expect(getConfidenceBase('conversation')).toBe(0.4);
  });

  it('returns correct halflife per type', () => {
    expect(getHalflifeDays('decision')).toBe(180);
    expect(getHalflifeDays('pattern')).toBe(90);
    expect(getHalflifeDays('conversation')).toBe(14);
  });
});
