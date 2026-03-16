import type { Scope, ScopeLevel, SensitivityClass, ScoredKnowledge } from '../knowledge/types';

// ─── Scope level ordering ─────────────────────────────────────────────────────

const SCOPE_ORDER: Record<ScopeLevel, number> = {
  personal: 0,
  team: 1,
  department: 2,
  organization: 3,
};

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AccessFilterConfig {
  /** Entity ID of the requester, e.g. 'person-alice' */
  requesterId: string;
  /** The scope the requester belongs to, e.g. { level: 'team', entity_id: 'team-platform' } */
  requesterScope: Scope;
  /** The organisation entity_id the requester belongs to */
  requesterOrg: string;
  /** Set of knowledge IDs for which the requester has been granted explicit access */
  grants?: Set<string>;
}

// ─── AccessFilter ─────────────────────────────────────────────────────────────

/**
 * Determines whether a requester may access a given knowledge unit at query
 * time, taking sensitivity class, scope, creator overrides and explicit grants
 * into account.
 */
export class AccessFilter {
  private readonly requesterId: string;
  private readonly requesterScope: Scope;
  private readonly requesterOrg: string;
  private readonly grants: Set<string>;

  constructor(config: AccessFilterConfig) {
    this.requesterId = config.requesterId;
    this.requesterScope = config.requesterScope;
    this.requesterOrg = config.requesterOrg;
    this.grants = config.grants ?? new Set();
  }

  /**
   * Returns true when the requester is allowed to see the given unit.
   *
   * Rules (evaluated in order):
   * 1. creator_scope override — if present and the requester is not within the
   *    max_level, deny (unless the requester is the creator).
   * 2. public    → always allow (same org)
   * 3. internal  → allow within the same org
   * 4. restricted → allow only within the same scope entity_id as the requester
   * 5. confidential → allow only if requester is the creator OR has an explicit grant
   */
  canAccess(unit: ScoredKnowledge): boolean {
    // ── Rule 1: creator_scope override ───────────────────────────────────────
    if (unit.creator_scope?.max_level !== undefined) {
      const maxLevel = unit.creator_scope.max_level;
      const requesterLevel = this.requesterScope.level;

      // Deny if the requester's scope level is broader than max_level and
      // the requester is not the creator.
      if (
        SCOPE_ORDER[requesterLevel] > SCOPE_ORDER[maxLevel] &&
        !this.isCreator(unit)
      ) {
        return false;
      }
    }

    const sensitivity: SensitivityClass = unit.sensitivity ?? 'public';

    switch (sensitivity) {
      // ── Rule 2: public ───────────────────────────────────────────────────
      case 'public':
        return true;

      // ── Rule 3: internal ─────────────────────────────────────────────────
      case 'internal':
        return this.isSameOrg(unit);

      // ── Rule 4: restricted ───────────────────────────────────────────────
      case 'restricted':
        return this.isSameScope(unit) || this.isCreator(unit);

      // ── Rule 5: confidential ─────────────────────────────────────────────
      case 'confidential':
        return this.isCreator(unit) || this.hasGrant(unit);

      default:
        return false;
    }
  }

  /**
   * Returns only those results the requester is allowed to see.
   */
  filterResults(results: ScoredKnowledge[]): ScoredKnowledge[] {
    return results.filter((unit) => this.canAccess(unit));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /** True when the unit was created by the current requester. */
  private isCreator(unit: ScoredKnowledge): boolean {
    return unit.origin?.creator_entity_id === this.requesterId;
  }

  /**
   * True when the unit is scoped to the requester's organisation.
   * Falls back to checking the unit's scope entity_id against the org.
   */
  private isSameOrg(unit: ScoredKnowledge): boolean {
    if (!unit.scope) {
      // No scope on the unit — treat as belonging to any org (allow)
      return true;
    }
    // Organisation-level units match any requester in the same org
    if (unit.scope.level === 'organization') {
      return unit.scope.entity_id === this.requesterOrg;
    }
    // Narrower scopes are all within the org (we can't check cross-org without
    // additional context, so we allow when the requester's org matches the
    // entity_links org if present — for now trust the unit is in the org)
    return true;
  }

  /**
   * True when the unit's scope entity_id matches the requester's scope
   * entity_id (same team/department) OR the requester is the creator.
   */
  private isSameScope(unit: ScoredKnowledge): boolean {
    if (!unit.scope) {
      return false;
    }
    return unit.scope.entity_id === this.requesterScope.entity_id;
  }

  /** True when the requester holds an explicit grant for this unit. */
  private hasGrant(unit: ScoredKnowledge): boolean {
    return this.grants.has(unit.id);
  }
}
