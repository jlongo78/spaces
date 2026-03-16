import type { KnowledgeType, SensitivityClass, ScopeLevel } from '../knowledge/types';

// ─── Public types ─────────────────────────────────────────────

export interface PropagationTarget {
  level: ScopeLevel;
  entity_id?: string;
}

export interface PolicyAction {
  max_scope?: ScopeLevel;
  propagate_to?: PropagationTarget[];
  trickle_down?: boolean;
  cannot_propagate?: boolean;
}

export interface PolicyMatch {
  type?: KnowledgeType;
  topics?: string[];
  sensitivity?: SensitivityClass;
  scope_level?: ScopeLevel;
}

export interface Policy {
  name: string;
  match: PolicyMatch;
  action: PolicyAction;
}

export interface PolicyInput {
  type?: KnowledgeType;
  topics?: string[];
  sensitivity?: SensitivityClass;
  scope_level?: ScopeLevel;
}

// ─── Engine ──────────────────────────────────────────────────

export class PolicyEngine {
  constructor(private readonly policies: Policy[]) {}

  /**
   * Evaluates all registered policies against the given input and returns
   * the list of actions from every policy whose match criteria are satisfied.
   * All specified match fields must match (AND logic); topic matching requires
   * at least one overlap.
   */
  evaluate(input: PolicyInput): PolicyAction[] {
    const actions: PolicyAction[] = [];

    for (const policy of this.policies) {
      if (this.matches(policy.match, input)) {
        actions.push(policy.action);
      }
    }

    return actions;
  }

  private matches(match: PolicyMatch, input: PolicyInput): boolean {
    if (match.type !== undefined && match.type !== input.type) {
      return false;
    }

    if (match.sensitivity !== undefined && match.sensitivity !== input.sensitivity) {
      return false;
    }

    if (match.scope_level !== undefined && match.scope_level !== input.scope_level) {
      return false;
    }

    if (match.topics !== undefined && match.topics.length > 0) {
      const inputTopics = input.topics ?? [];
      const hasOverlap = match.topics.some((t) => inputTopics.includes(t));
      if (!hasOverlap) {
        return false;
      }
    }

    return true;
  }
}
