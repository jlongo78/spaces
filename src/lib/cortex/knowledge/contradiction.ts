import type { KnowledgeUnit } from './types';

export interface Contradiction {
  existingId: string;
  existingText: string;
  similarity: number;
  existingCreated: string;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export function detectContradictions(
  newUnit: KnowledgeUnit,
  existingUnits: KnowledgeUnit[],
  similarityThreshold = 0.85,
): Contradiction[] {
  const contradictions: Contradiction[] = [];

  for (const existing of existingUnits) {
    if (existing.id === newUnit.id) continue;
    if (existing.type !== newUnit.type) continue;

    const similarity = cosineSimilarity(newUnit.vector, existing.vector);
    if (similarity >= similarityThreshold) {
      if (existing.created !== newUnit.created) {
        contradictions.push({
          existingId: existing.id,
          existingText: existing.text,
          similarity,
          existingCreated: existing.created,
        });
      }
    }
  }

  return contradictions.sort((a, b) => b.similarity - a.similarity);
}
