export const AUTHORITY_FACTORS = {
  conversation: 1.0,
  git_commit: 1.1,
  pr_review: 1.1,
  document: 1.2,
  behavioral: 1.0,
  distillation: 1.1,
  manual: 1.3,
} as const;

export interface EvidenceScoreInput {
  baseConfidence: number;
  corroborations: number;
  accessCount: number;
  authorityFactor: number;
  contradictionCount: number;
}

export function computeEvidenceScore(input: EvidenceScoreInput): number {
  const { baseConfidence, corroborations, accessCount, authorityFactor, contradictionCount } = input;
  const corroborationBoost = 1 + 0.1 * Math.min(corroborations, 10);
  const accessBoost = 1 + 0.01 * Math.min(accessCount, 50);
  const contradictionPenalty = 1 + 0.5 * contradictionCount;
  const raw = (baseConfidence * corroborationBoost * accessBoost * authorityFactor) / contradictionPenalty;
  return Math.max(0, Math.min(1.0, raw));
}
