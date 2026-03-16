import type { KnowledgeType, ScopeLevel, SensitivityClass } from '../knowledge/types';

// ─── Type Weight Table ─────────────────────────────────────────

export const PROMOTION_TYPE_WEIGHTS: Record<KnowledgeType, number> = {
  decision:     1.5,
  error_fix:    1.3,
  pattern:      1.2,
  preference:   1.0,
  code_pattern: 1.0,
  command:      0.8,
  context:      0.7,
  summary:      0.7,
  conversation: 0.5,
};

// ─── Constants ────────────────────────────────────────────────

export const HOP_DECAY = 0.85;

// ─── Freshness helper ─────────────────────────────────────────

function freshnessFactor(createdDaysAgo: number): number {
  if (createdDaysAgo <= 30) return 1.0;
  if (createdDaysAgo <= 90) return 0.8;
  return 0.5;
}

// ─── computePromotionScore ─────────────────────────────────────

export interface PromotionScoreInput {
  evidenceScore: number;
  type: KnowledgeType;
  createdDaysAgo: number;
}

export function computePromotionScore(input: PromotionScoreInput): number {
  const { evidenceScore, type, createdDaysAgo } = input;
  const typeWeight = PROMOTION_TYPE_WEIGHTS[type];
  const freshness = freshnessFactor(createdDaysAgo);
  return Math.min(1.0, evidenceScore * typeWeight * freshness);
}

// ─── shouldPromote ────────────────────────────────────────────

export interface ShouldPromoteInput {
  currentLevel: ScopeLevel;
  promotionScore: number;
  corroborations: number;
  sensitivity: SensitivityClass;
  hasContradictions: boolean;
}

/** Sensitivity levels that block promotion entirely. */
const BLOCKING_SENSITIVITY: SensitivityClass[] = ['restricted', 'confidential'];

interface PromotionThreshold {
  minScore: number;
  minCorroborations: number;
  maxSensitivity: SensitivityClass;
  blockOnContradictions: boolean;
}

const THRESHOLDS: Partial<Record<ScopeLevel, PromotionThreshold>> = {
  personal: {
    minScore: 0.6,
    minCorroborations: 2,
    maxSensitivity: 'internal',
    blockOnContradictions: false,
  },
  team: {
    minScore: 0.75,
    minCorroborations: 3,
    maxSensitivity: 'internal',
    blockOnContradictions: false,
  },
  department: {
    minScore: 0.9,
    minCorroborations: 5,
    maxSensitivity: 'internal',
    blockOnContradictions: true,
  },
};

/** Ordered sensitivity levels from least to most restrictive. */
const SENSITIVITY_ORDER: SensitivityClass[] = ['public', 'internal', 'restricted', 'confidential'];

function sensitivityExceeds(actual: SensitivityClass, max: SensitivityClass): boolean {
  return SENSITIVITY_ORDER.indexOf(actual) > SENSITIVITY_ORDER.indexOf(max);
}

export function shouldPromote(input: ShouldPromoteInput): boolean {
  const { currentLevel, promotionScore, corroborations, sensitivity, hasContradictions } = input;

  if (BLOCKING_SENSITIVITY.includes(sensitivity)) return false;

  const threshold = THRESHOLDS[currentLevel];
  if (!threshold) return false;

  if (promotionScore < threshold.minScore) return false;
  if (corroborations < threshold.minCorroborations) return false;
  if (sensitivityExceeds(sensitivity, threshold.maxSensitivity)) return false;
  if (threshold.blockOnContradictions && hasContradictions) return false;

  return true;
}

// ─── getNextLevel ─────────────────────────────────────────────

const NEXT_LEVEL: Partial<Record<ScopeLevel, ScopeLevel>> = {
  personal:   'team',
  team:       'department',
  department: 'organization',
};

export function getNextLevel(current: ScopeLevel): ScopeLevel | null {
  return NEXT_LEVEL[current] ?? null;
}
