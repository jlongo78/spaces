import type { KnowledgeType, ScopeLevel } from '../knowledge/types';

// ─── Trickle Mode ─────────────────────────────────────────────

export type TrickleMode = 'push' | 'visibility';

// ─── Defaults Table ───────────────────────────────────────────

export const TRICKLE_DEFAULTS: Record<KnowledgeType, TrickleMode> = {
  decision:     'push',
  preference:   'push',
  error_fix:    'visibility',
  pattern:      'visibility',
  code_pattern: 'visibility',
  command:      'visibility',
  context:      'visibility',
  summary:      'visibility',
  conversation: 'visibility',
};

// ─── getTrickleMode ───────────────────────────────────────────

/**
 * Returns the trickle mode for a given knowledge type at a given scope level.
 *
 * Only org-level knowledge trickles down.  Returns null for any sub-org scope.
 * Security topics (topics array contains 'security') always receive 'push'.
 * Otherwise the mode is determined by TRICKLE_DEFAULTS.
 */
export function getTrickleMode(
  type: KnowledgeType,
  scopeLevel: ScopeLevel,
  topics?: string[],
): TrickleMode | null {
  if (scopeLevel !== 'organization') return null;

  if (topics && topics.includes('security')) return 'push';

  return TRICKLE_DEFAULTS[type];
}
