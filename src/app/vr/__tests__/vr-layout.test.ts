import { describe, it, expect } from 'vitest';
import { computePanePositions } from '../vr-layout';

describe('computePanePositions', () => {
  it('returns empty array for 0 panes', () => {
    expect(computePanePositions(0)).toEqual([]);
  });

  it('places single pane centered ahead', () => {
    const positions = computePanePositions(1);
    expect(positions).toHaveLength(1);
    expect(positions[0].x).toBeCloseTo(0, 1);
    expect(positions[0].y).toBeCloseTo(1.6, 1);
    expect(positions[0].z).toBeCloseTo(-6, 1);
  });

  it('places 2 panes in 70° arc', () => {
    const positions = computePanePositions(2);
    expect(positions).toHaveLength(2);
    expect(positions[0].x).toBeCloseTo(-positions[1].x, 1);
    expect(positions[0].z).toBeCloseTo(positions[1].z, 1);
  });

  it('places 8 panes in 220° arc', () => {
    const positions = computePanePositions(8);
    expect(positions).toHaveLength(8);
    positions.forEach(p => expect(p.y).toBeCloseTo(1.6, 1));
    positions.forEach(p => {
      const dist = Math.sqrt(p.x * p.x + p.z * p.z);
      expect(dist).toBeCloseTo(6, 1);
    });
  });

  it('accepts custom radius and eye height', () => {
    const positions = computePanePositions(1, { radius: 4, eyeHeight: 2 });
    expect(positions[0].y).toBeCloseTo(2, 1);
    expect(positions[0].z).toBeCloseTo(-4, 1);
  });
});
