// ─── Constants ─────────────────────────────────────────────────

export const ARCHIVE_THRESHOLD = 0.1;

// ─── computeDecay ──────────────────────────────────────────────

export interface ComputeDecayInput {
  daysSinceAccess: number;
  currentEvidenceScore: number;
}

/**
 * Returns the amount to SUBTRACT from the evidence score due to staleness.
 *
 * - Returns 0 if daysSinceAccess ≤ 30.
 * - Otherwise: ((daysSinceAccess - 30) / 365) * 0.2
 * - Capped at currentEvidenceScore (never produces a negative result).
 */
export function computeDecay(input: ComputeDecayInput): number {
  const { daysSinceAccess, currentEvidenceScore } = input;

  if (daysSinceAccess <= 30) return 0;

  const raw = ((daysSinceAccess - 30) / 365) * 0.2;
  return Math.min(raw, currentEvidenceScore);
}

// ─── shouldArchive ─────────────────────────────────────────────

export interface ShouldArchiveInput {
  evidenceScore: number;
  daysSinceCreated: number;
}

/**
 * Returns true when a knowledge unit should be archived:
 * - evidenceScore < ARCHIVE_THRESHOLD (0.1)
 * - AND daysSinceCreated ≥ 180
 */
export function shouldArchive(input: ShouldArchiveInput): boolean {
  const { evidenceScore, daysSinceCreated } = input;
  return evidenceScore < ARCHIVE_THRESHOLD && daysSinceCreated >= 180;
}
