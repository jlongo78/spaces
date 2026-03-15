import type { IntentBiases } from './intent';

export interface ScopeWeightInput {
  graphProximity: number;    // 0-1
  scopeLevel: string;       // 'personal' | 'team' | 'department' | 'organization'
  intentBiases: IntentBiases;
  authorityFactor: number;
}

export interface AuthorityParams {
  role_boost: number;
  expertise_weight: number;
  source_type?: string;
}

/**
 * Computes a composite scope weight: graphProximity × intentBias × authorityFactor.
 *
 * @param input - ScopeWeightInput with proximity, scope level, biases and authority
 * @returns Composite weight (non-negative)
 */
export function computeScopeWeight(input: ScopeWeightInput): number {
  const { graphProximity, scopeLevel, intentBiases, authorityFactor } = input;

  const intentBias = intentBiases.scope_boost[scopeLevel] ?? 1.0;
  const weight = graphProximity * intentBias * authorityFactor;

  return Math.max(0, weight);
}

/**
 * Looks up the type boost for the given knowledge type from the intent biases.
 * Defaults to 1.0 if the type is not present.
 *
 * @param knowledgeType - The knowledge type to look up
 * @param intentBiases  - The biases from the detected intent
 * @returns Type boost multiplier
 */
export function computeTypeBoost(
  knowledgeType: string,
  intentBiases: IntentBiases,
): number {
  return intentBiases.type_boost[knowledgeType] ?? 1.0;
}

/**
 * Computes an authority factor from role and expertise weights.
 * Documents (source_type === 'document') get a base boost of 1.2.
 *
 * @param params - AuthorityParams
 * @returns Authority factor
 */
export function computeAuthority(params: AuthorityParams): number {
  const { role_boost, expertise_weight, source_type } = params;
  const documentBoost = source_type === 'document' ? 1.2 : 1.0;
  return (role_boost + expertise_weight) * documentBoost;
}
