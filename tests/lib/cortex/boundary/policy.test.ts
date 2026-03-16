import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '@/lib/cortex/boundary/policy';
import type { Policy } from '@/lib/cortex/boundary/policy';

describe('PolicyEngine', () => {
  it('returns empty array when no policies match', () => {
    const engine = new PolicyEngine([
      {
        name: 'confidential-block',
        match: { sensitivity: 'confidential' },
        action: { cannot_propagate: true },
      },
    ]);
    const result = engine.evaluate({ sensitivity: 'public' });
    expect(result).toEqual([]);
  });

  it('matches by knowledge type and returns the corresponding action', () => {
    const engine = new PolicyEngine([
      {
        name: 'decision-propagate',
        match: { type: 'decision' },
        action: { propagate_to: [{ level: 'department' }] },
      },
    ]);
    const result = engine.evaluate({ type: 'decision' });
    expect(result).toHaveLength(1);
    expect(result[0].propagate_to).toEqual([{ level: 'department' }]);
  });

  it('matches by sensitivity and sets cannot_propagate', () => {
    const engine = new PolicyEngine([
      {
        name: 'confidential-block',
        match: { sensitivity: 'confidential' },
        action: { cannot_propagate: true },
      },
    ]);
    const result = engine.evaluate({ sensitivity: 'confidential' });
    expect(result).toHaveLength(1);
    expect(result[0].cannot_propagate).toBe(true);
  });

  it('matches by topic overlap and applies scope + routing action', () => {
    const engine = new PolicyEngine([
      {
        name: 'security-scope',
        match: { topics: ['security', 'infosec'] },
        action: {
          max_scope: 'department',
          propagate_to: [{ level: 'team', entity_id: 'team-security' }],
        },
      },
    ]);
    const result = engine.evaluate({ topics: ['security', 'performance'] });
    expect(result).toHaveLength(1);
    expect(result[0].max_scope).toBe('department');
    expect(result[0].propagate_to).toEqual([
      { level: 'team', entity_id: 'team-security' },
    ]);
  });

  it('returns multiple matching policies when several criteria match', () => {
    const policies: Policy[] = [
      {
        name: 'decision-propagate',
        match: { type: 'decision' },
        action: { propagate_to: [{ level: 'department' }] },
      },
      {
        name: 'internal-trickle',
        match: { sensitivity: 'internal' },
        action: { trickle_down: true },
      },
    ];
    const engine = new PolicyEngine(policies);
    const result = engine.evaluate({ type: 'decision', sensitivity: 'internal' });
    expect(result).toHaveLength(2);
  });

  it('does not match when topic criteria have no overlap', () => {
    const engine = new PolicyEngine([
      {
        name: 'security-scope',
        match: { topics: ['security', 'infosec'] },
        action: { max_scope: 'department' },
      },
    ]);
    // "architecture" has no overlap with ["security", "infosec"]
    const result = engine.evaluate({ topics: ['architecture'] });
    expect(result).toEqual([]);
  });
});
