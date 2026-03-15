export function computeRelevanceScore(params: {
  similarity: number;
  confidence: number;
  stale_score: number;
  created: string;
  evidence_score?: number;
}): number {
  const recencyBoost = computeRecencyBoost(params.created);
  const evidence = params.evidence_score ?? params.confidence;
  return Math.min(1.0, params.similarity * evidence * (1 - params.stale_score) * recencyBoost);
}

export function computeRecencyBoost(created: string): number {
  const ageMs = Date.now() - new Date(created).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) return 1.1;
  if (ageDays <= 30) return 1.05;
  return 1.0;
}

export function computeStaleScore(
  created: string,
  halflifeDays: number,
): number {
  const ageMs = Date.now() - new Date(created).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return 1 - Math.pow(2, -ageDays / halflifeDays);
}
