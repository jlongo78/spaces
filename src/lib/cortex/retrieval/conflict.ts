import type { ScoredKnowledge } from '../knowledge/types';

export interface ConflictPair {
  unitA: ScoredKnowledge;
  unitB: ScoredKnowledge;
}

export function detectConflicts(results: ScoredKnowledge[]): ConflictPair[] {
  // Build a map of result IDs for quick lookup
  const resultMap = new Map<string, ScoredKnowledge>();
  for (const result of results) {
    resultMap.set(result.id, result);
  }

  const seen = new Set<string>();
  const conflicts: ConflictPair[] = [];

  for (const result of results) {
    const refs = result.contradiction_refs;
    if (!refs || refs.length === 0) continue;

    for (const refId of refs) {
      const other = resultMap.get(refId);
      if (!other) continue;

      // Use sorted ID pair as dedup key to avoid symmetric duplicates
      const key = [result.id, other.id].sort().join('|');
      if (seen.has(key)) continue;

      seen.add(key);
      conflicts.push({ unitA: result, unitB: other });
    }
  }

  return conflicts;
}
