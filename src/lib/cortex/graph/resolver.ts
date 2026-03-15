import type { EntityGraph } from './entity-graph';
import type { Entity } from './types';

export interface ResolvedEntity {
  entity: Entity;
  confidence: number;
  method: 'alias' | 'fuzzy' | 'name';
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Allocate a single row for space efficiency
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }

  return prev[n];
}

export class EntityResolver {
  constructor(private graph: EntityGraph) {}

  resolve(text: string): ResolvedEntity | null {
    const normalized = text.toLowerCase().trim();

    // 1. Exact alias match
    const exact = this.graph.findByAlias(normalized);
    if (exact) {
      return { entity: exact, confidence: 0.95, method: 'alias' };
    }

    // 2. Fuzzy match via Levenshtein distance ≤ 2 against all entity aliases
    const allEntities = this.graph.listEntities();
    let best: ResolvedEntity | null = null;

    for (const entity of allEntities) {
      const aliases = this.graph.getAliases(entity.id);
      for (const alias of aliases) {
        const dist = levenshtein(normalized, alias);
        if (dist <= 2) {
          const confidence = 0.9 - 0.15 * dist;
          if (best === null || confidence > best.confidence) {
            best = { entity, confidence, method: 'fuzzy' };
          }
        }
      }
    }

    return best;
  }

  extractEntities(text: string): ResolvedEntity[] {
    const lower = text.toLowerCase();
    const allEntities = this.graph.listEntities();
    const found = new Map<string, ResolvedEntity>();

    for (const entity of allEntities) {
      const aliases = this.graph.getAliases(entity.id);
      for (const alias of aliases) {
        // Skip short aliases to avoid false positives
        if (alias.length < 3) continue;
        if (lower.includes(alias)) {
          if (!found.has(entity.id)) {
            found.set(entity.id, { entity, confidence: 0.85, method: 'alias' });
          }
        }
      }
    }

    return Array.from(found.values());
  }
}
