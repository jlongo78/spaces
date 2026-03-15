# Cortex v2: Organization-Scale Knowledge System

**Date:** 2026-03-14
**Status:** Design approved, pending implementation plan
**Scope:** Evolution of Cortex from flat-layer RAG to graph-connected, evidence-tracked, boundary-aware organizational knowledge system

## Overview

Cortex v2 evolves the existing personal/workspace/team knowledge system into an organization-scale knowledge graph with bi-directional knowledge flow, dynamic multi-source retrieval, and three-layer access control. The system observes how the organization actually works — from conversations to git commits to deployment patterns — and builds a living model of knowledge, expertise, and relationships.

### Design Principles

- **Graph distance is gravity** — knowledge relevance is modeled as proximity in a relationship graph, not flat layer membership
- **Evidence over assertion** — knowledge earns trust through independent corroboration, not just by existing
- **Contextual truth** — there is no single truth; the system serves the perspective most relevant to the requester and surfaces conflicts transparently
- **Most restrictive wins** — three layers of boundary enforcement (auto-classification, policy, creator override) where the tightest restriction always applies
- **Adapter pattern for extensibility** — every signal source normalizes to a common envelope; new sources require zero pipeline changes

### Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `DEDUP_COSINE_THRESHOLD` | 0.90 | Two units are duplicates (keep higher-scored) |
| `CONTRADICTION_COSINE_THRESHOLD` | 0.80 | Two units are similar enough to be potential contradictions (0.80-0.90 is the "contradiction zone") |
| `CORROBORATION_COSINE_THRESHOLD` | 0.85 | Two units from different sources confirm each other |
| `HOP_DECAY_FACTOR` | 0.85 | Confidence multiplier per propagation hop (v1 used 0.80; increased to preserve more signal across hops) |
| `PROMOTION_DECAY` | 0.85 | Same as HOP_DECAY_FACTOR (applied on promotion) |
| `GRAVITY_INTERVAL_MS` | 21600000 | Gravity scheduler runs every 6 hours |
| `ARCHIVE_THRESHOLD` | 0.1 | Evidence score below which units are archived after 6 months |
| `MAX_GRAPH_HOPS` | 4 | Maximum BFS depth for graph proximity computation |

### Current State (v1)

- 3 flat layers: personal, workspace, team
- 9 knowledge types with confidence scores and staleness
- LanceDB vector store with local MiniLM-L6-v2 embeddings (384d)
- Two-phase deduplication (hash + cosine)
- Regex-based extractors for error_fix, decision, command types
- Learn hook captures Q&A from Claude Code sessions
- RAG hook injects context into prompts (<150ms)
- Federation search across connected nodes
- LLM distillation queue (requires API key)
- ~542 knowledge units across personal and workspace layers

## Architecture: Six Pillars

The system is built in three implementation phases (plus a future learning phase) across six interconnected pillars:

```
Phase 1 (Foundation):  ① Entity Graph + ② Knowledge Unit Evolution
Phase 2 (Intelligence): ③ Context Assembly Engine + ④ Boundary Engine
Phase 3 (Expansion):   ⑤ Observable Signal Ingestion + ⑥ Gravity System
Phase 4 (Future):      Learned attention weights over the Context Assembly Engine
```

---

## Pillar 1: Entity Graph

A lightweight relationship graph modeling people, teams, departments, projects, systems, and their connections. Stored in SQLite (adjacency list + recursive CTEs), not a full graph database — the graph is hundreds-to-thousands of nodes, not millions.

### Entity Types (Nodes)

**People & Groups:**
- **Person** — id, name, email, role, expertise[]
- **Team** — id, name, purpose, department_id
- **Department** — id, name, org_id
- **Organization** — id, name, domain (one per Spaces instance)

**Technical Entities:**
- **Project** — id, name, repo_url, workspace_id
- **System** — id, name, type, project_id (e.g., "Auth Service", "Cortex")
- **Module** — id, name, path_pattern, system_id (e.g., `src/lib/cortex/**`)
- **Topic** — id, name, description (e.g., "authentication", "vector-search")

### Relationship Types (Edges)

All edges carry a `weight` (0-1) and `metadata` JSON.

**Organizational:**
- Person —MEMBER_OF→ Team (role: "lead" | "member")
- Person —BELONGS_TO→ Department (inferred via team)
- Team —PART_OF→ Department
- Department —PART_OF→ Organization

**Technical:**
- Person —WORKS_ON→ Project (weight from commit frequency)
- Person —EXPERT_IN→ Topic (weight grows with evidence)
- Person —TOUCHES→ Module (from git blame/commits)
- Team —OWNS→ Project
- Team —OWNS→ System
- Project —CONTAINS→ System
- System —CONTAINS→ Module
- System —DEPENDS_ON→ System (inter-service deps)
- Module —RELATES_TO→ Topic

**Knowledge:**
- KnowledgeUnit —CREATED_BY→ Person
- KnowledgeUnit —ABOUT→ Topic | System | Module
- KnowledgeUnit —SCOPED_TO→ Team | Department | Organization
- KnowledgeUnit —DERIVED_FROM→ KnowledgeUnit (distillation lineage)

### Storage

Entity IDs use the format `{type}-{slug}` (e.g., `person-alice`, `team-platform`, `system-auth-service`, `topic-authentication`). Slugs are lowercase, hyphen-separated, derived from the entity name.

```sql
-- SQLite tables
entities(id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, metadata JSON, created TEXT, updated TEXT)
edges(source_id TEXT NOT NULL, target_id TEXT NOT NULL, relation TEXT NOT NULL, weight REAL DEFAULT 1.0, metadata JSON, created TEXT,
      PRIMARY KEY (source_id, target_id, relation),
      FOREIGN KEY (source_id) REFERENCES entities(id),
      FOREIGN KEY (target_id) REFERENCES entities(id))
entity_aliases(entity_id TEXT NOT NULL, alias TEXT NOT NULL,
      FOREIGN KEY (entity_id) REFERENCES entities(id))
access_grants(knowledge_id TEXT NOT NULL, grantee_entity_id TEXT NOT NULL, granted_by TEXT NOT NULL, created TEXT,
      PRIMARY KEY (knowledge_id, grantee_entity_id))

-- Indexes
CREATE INDEX idx_edges_target ON edges(target_id, relation);
CREATE INDEX idx_aliases_alias ON entity_aliases(alias);
CREATE INDEX idx_grants_grantee ON access_grants(grantee_entity_id);

-- Key queries via recursive CTEs:
-- Graph distance between two entities (BFS)
-- All entities within N hops of a person
-- All knowledge linked to entities within N hops
-- Entity resolution: "auth" → which entity?
```

Edge weights are updated in-place (UPSERT on the composite primary key). A given source-target-relation triple can only have one edge; multiple relationships between the same entities use different `relation` values.

### Auto-Population

- People → from Spaces user accounts
- Teams/Departments → admin configures or inferred from workspace membership
- Projects → from workspaces + git remotes
- Systems/Modules → inferred from directory structure + package.json
- Topics → extracted from knowledge units, file paths, git tags
- WORKS_ON edges → computed from git commit frequency
- TOUCHES edges → computed from git blame
- EXPERT_IN edges → grows when a person's knowledge on a topic is accessed

---

## Pillar 2: Knowledge Unit Evolution

The KnowledgeUnit schema evolves to support graph connections, evidence tracking, sensitivity classification, and propagation history.

### Schema Changes (v1 → v2)

**Removed:**
- `layer: Layer` — replaced by `scope`

**Added:**
```typescript
// Graph Links
entity_links: EntityLink[]   // connections to graph nodes
scope: Scope                 // replaces flat layer

// Evidence Tracking
evidence_score: number       // computed from access, corroboration, authority
corroborations: number       // independent sources confirming this knowledge
contradiction_refs: string[] // IDs of contradicting units

// Boundaries
sensitivity: SensitivityClass  // auto-classified: public|internal|restricted|confidential
creator_scope: ScopeOverride | null  // creator's restriction override

// Provenance
origin: Origin                // where this knowledge came from
propagation_path: PropHop[]   // audit trail of scope changes
```

### New Types

```typescript
interface EntityLink {
  entity_id: string
  entity_type: EntityType  // "person" | "team" | "system" | "topic" | etc.
  relation: "created_by" | "about" | "scoped_to" | "derived_from"
  weight: number  // 0-1
}

interface Scope {
  level: "personal" | "team" | "department" | "organization"
  entity_id: string  // which person/team/dept/org (format: {type}-{slug})
}

type SensitivityClass = "public" | "internal" | "restricted" | "confidential"

interface ScopeOverride {
  max_level: Scope["level"]
  // Creator can restrict further but never widen beyond policy
}

interface Origin {
  source_type: "conversation" | "git_commit" | "pr_review" | "document"
             | "behavioral" | "distillation" | "manual"
  source_ref: string       // session ID, commit SHA, PR URL, etc.
  creator_entity_id: string
}

interface PropHop {
  from_scope: Scope
  to_scope: Scope
  reason: "evidence_threshold" | "policy_push" | "manual_promote"
  timestamp: string
  confidence_at_hop: number  // decays per hop (×0.85)
}
```

### Evidence Score Computation

`evidence_score` is a derived value (0-1), recomputed on access and during gravity scheduling:

```
evidence_score = min(1.0,
  base_confidence
  × (1 + 0.1 × corroborations)
  × (1 + 0.01 × min(access_count, 50))
  × authority_factor
  ÷ (1 + 0.5 × contradiction_count)
)
```

- `base_confidence`: from KnowledgeType defaults (decision: 0.8, pattern: 0.8, preference: 0.95, error_fix: 0.8, context: 0.6, etc.)
- `corroborations`: count of independent sources confirming this knowledge (capped contribution at 10)
- `access_count`: how often this knowledge was retrieved (diminishing returns, capped at 50)
- `authority_factor`: 1.0 for conversations, 1.1 for git commits, 1.2 for documents/ADRs, 1.3 for manual/admin teach
- `contradiction_count`: number of active contradictions (penalizes contested knowledge)

### Migration Strategy

Existing ~542 units migrate with these mappings:
- `layer: "personal"` → `scope: { level: "personal", entity_id: "person-{user}" }`
- `layer: "workspace"` → `scope: { level: "team", entity_id: "team-default" }`
- `layer: "team"` → `scope: { level: "organization", entity_id: "org-default" }`
- New fields get defaults: `evidence_score: 0.5`, `sensitivity: "internal"`, `entity_links: []` (backfilled by signal ingestion)
- Old API still accepts `layer` param, maps internally to scope (backward compatible)

---

## Pillar 3: Context Assembly Engine

The retrieval brain. Replaces the current single-vector-search with a 6-stage pipeline that dynamically weights multiple knowledge sources.

### Stage 1: Intent Detection

Classify the query into intent categories using regex patterns + embedding similarity against intent exemplars:

| Intent | Weight Bias |
|--------|-------------|
| debugging | +personal, +error_fix, +recent |
| architecture | +team, +decisions, +department |
| onboarding | +org-wide, +patterns, +docs |
| policy | +org-wide, +decisions, +confidential |
| how-to | +personal, +commands, +patterns |
| review | +team, +code_patterns, +preferences |
| security | +security-team, +restricted scope |
| general | no bias, pure graph distance |

No LLM call — fast regex + embedding match.

### Stage 2: Entity Resolution

Extract entity references from query text:
1. Exact alias lookup (`entity_aliases` table)
2. Fuzzy alias match (Levenshtein distance ≤ 2)
3. Embedding similarity against entity name/description vectors

### Stage 3: Weight Computation

For each accessible knowledge scope:

```
weight(scope) = graph_proximity × intent_bias × freshness_bonus × authority
```

- `graph_proximity`: `1 / (1 + shortest_path_distance)` from requester to scope
- `intent_bias`: from Stage 1 intent category (values defined in the intent table above)
- `freshness_bonus`: 1.1 if scope has relevant activity in last 7 days, 1.05 if last 30 days, 1.0 otherwise
- `authority`: computed as `max(1.0, role_boost + expertise_weight)` where:
  - `role_boost`: 0.0 for member, 0.1 for lead, 0.15 for senior/principal, 0.2 for director+ (from Person entity role field)
  - `expertise_weight`: the EXPERT_IN edge weight (0-1) between the source entity and query-relevant topics
  - For non-person sources (org standards, official docs): `origin.source_type === "document"` gets authority 1.2 (documents outrank conversations)

Computed via SQLite recursive CTE for graph_proximity, cached per request (~10ms warm, ~30ms cold; precompute proximity for current user at session start as fallback).

### Stage 4: Parallel Multi-Source Search

Query all weighted sources concurrently via `Promise.allSettled`:
- Higher-weight sources get more result slots (proportional to weight)
- 100ms timeout per source; failures don't block other sources
- Boundary Engine filters inaccessible scopes BEFORE search begins

### Stage 5: Fusion + Re-Ranking

Score each candidate:

```
final_score = vector_similarity × source_weight × evidence_score × (1 - stale_score) × type_boost
```

- Deduplicate: if two results have cosine > 0.9, keep higher-scored, note corroboration
- Sort by final_score, take top K (default: 5)

### Stage 6: Conflict Detection + Context Formatting

- Check `contradiction_refs` across top results
- Flag contested knowledge with both perspectives
- Format as annotated `<cortex-context>` with source attribution, conflict callouts, and evidence indicators

### Performance Budget

| Stage | Target | Method |
|-------|--------|--------|
| 1-2: Intent + Entities | ~5ms | Regex + alias lookup |
| 3: Weight Computation | ~10ms | Graph BFS, cached SQLite CTE |
| 4-6: Search + Fuse | ~80ms | Parallel vector search |
| **Total** | **<150ms** | Within hook's 5s timeout |

---

## Pillar 4: Boundary Engine

Three-layer access control evaluated in order. Most restrictive classification always wins.

### Layer 1: Auto-Classification

Regex-based content analysis assigns sensitivity (fast, deterministic, auditable):

| Detector | Triggers | Classification |
|----------|----------|----------------|
| Secrets | API keys, tokens, passwords, connection strings | confidential |
| Personnel | Performance reviews, salary, hiring, 1:1 notes | confidential |
| Security | Vulnerabilities, exploits, CVEs, incident details | restricted |
| Business | Revenue, strategy, unreleased plans, customer data | restricted |
| Technical | Architecture, patterns, code, decisions | internal |
| General | Common patterns, public docs, well-known techniques | public |

### Layer 2: Organizational Policy

Admin-defined rules that control propagation and access:

```typescript
interface Policy {
  name: string
  match: {
    type?: KnowledgeType
    topics?: string[]
    sensitivity?: SensitivityClass
    scope_level?: Scope["level"]
  }
  action: {
    max_scope?: Scope["level"]       // can't propagate beyond this level
    propagate_to?: PropagationTarget[] // MUST reach these specific scopes
    trickle_down?: boolean           // auto-visible to child scopes
    cannot_propagate?: boolean       // locked to current scope
  }
}

interface PropagationTarget {
  level: Scope["level"]
  entity_id?: string  // specific entity, or omit for "all at this level"
  // e.g., { level: "team", entity_id: "team-security" } = must reach security team
  // e.g., { level: "department" } = must reach at least department level
}
```

`propagate_to` replaces the previous `min_scope` and `required_scope` — it's a single array that handles both "must reach this level" and "must reach this specific team." When multiple targets are specified, all must be satisfied. `max_scope` takes precedence: if a target would exceed `max_scope`, it's skipped (policy contradiction logged as warning).

Example policies:
- Security findings must reach security team, cannot leave department
- Architecture decisions always propagate to department+
- Org decisions auto-trickle-down to all teams
- Confidential knowledge cannot propagate from personal scope

Stored in Cortex config, admin-editable. Evaluated at ingestion time and query time.

### Layer 3: Creator Override

The person who created knowledge can restrict further (never widen):
- Creator can restrict: team → personal
- Creator CANNOT widen: restricted → public
- Policy overrides auto-class only upward (more restrictive wins)

Set via MCP tool (`cortex_teach --scope personal`), API, or future UI toggle.

### Query-Time Enforcement

Before the Context Assembly Engine searches, compute accessible scopes:

| Sensitivity | Same Scope | Same Dept | Same Org | Cross Org |
|-------------|-----------|-----------|----------|-----------|
| public | read | read | read | read |
| internal | read | read | read | denied |
| restricted | read | policy-gated | denied | denied |
| confidential | grant-only | denied | denied | denied |

**Grant mechanism for confidential knowledge:** Creators can grant access to specific people via the `access_grants` table (defined in Pillar 1 Storage). Grants are explicit: `{ knowledge_id, grantee_entity_id, granted_by, created }`. At query time, confidential knowledge is accessible if `requester_entity_id === creator_entity_id` OR an `access_grants` row exists for that requester. Grants are set via MCP tool (`cortex_teach --grant person-alice`), API (`POST /api/cortex/knowledge/{id}/grant`), or future UI.

### Audit Trail

Every access decision logged in append-only SQLite table: who requested, what returned, what denied and why. Queryable by admins. Default retention: 90 days.

---

## Pillar 5: Observable Signal Ingestion

Seven signal sources, each with an adapter that normalizes to a common `SignalEnvelope`.

### Signal Sources

1. **Conversations** (existing, evolved) — Claude Code Q&A via learn hook. Enhanced with auto-entity linking, multi-turn context extraction, intent tagging.

2. **Git History** — commits, blame, file change frequency. Extracts: who works on what (TOUCHES edges), commit messages → decisions/fixes, co-change clusters → system boundaries.

3. **PR Reviews** — review comments, approval patterns. Extracts: code quality patterns, architectural preferences, reviewer expertise (EXPERT_IN edges), team conventions.

4. **Documents** — ADRs, READMEs, runbooks, wiki pages. Higher authority weight than conversations. Extracts: official decisions, architecture documentation, operational procedures.

5. **Test Signals** — test failures, flaky tests, coverage gaps. Extracts: reliability patterns, modules that break together (DEPENDS_ON edges), error-prone areas.

6. **Deployment Patterns** — deploy frequency, rollbacks, incidents. Extracts: system stability patterns, risky change areas, deployment best practices, incident response knowledge.

7. **Behavioral Inference** — derived from observing all other signals. Infers: actual team boundaries vs org chart, expertise decay, knowledge gaps, de facto ownership.

### Adapter Architecture

```typescript
interface SignalEnvelope {
  text: string
  origin: Origin
  entities: EntityLink[]         // detected entity references
  suggested_type: KnowledgeType
  suggested_sensitivity: SensitivityClass
  raw_metadata: Record<string, unknown>
}

interface SignalAdapter {
  name: string
  schedule: "realtime" | "polling" | "webhook" | "cron"
  extract(): AsyncIterable<SignalEnvelope>
  healthCheck(): Promise<boolean>
}
```

All adapters produce `SignalEnvelope`. Adding a new source = implement one interface, zero pipeline changes.

### Unified Signal Pipeline

A new `SignalPipeline` consumes envelopes from all adapters and replaces the existing `IngestionPipeline` as the primary entry point (the old pipeline is wrapped as the Conversation adapter for backward compatibility).

```typescript
class SignalPipeline {
  async ingest(envelope: SignalEnvelope): Promise<IngestResult> {
    // 1. Dedup: hash check (pre-embed) + cosine check (post-embed)
    // 2. Entity resolution: resolve envelope.entities against graph,
    //    create EntityLinks for the knowledge unit
    // 3. Sensitivity: envelope.suggested_sensitivity is the starting point,
    //    then Boundary Engine Layer 1 (auto-classification) can UPGRADE
    //    sensitivity (never downgrade). Most restrictive wins.
    // 4. Type resolution: envelope.suggested_type is accepted unless
    //    extractors detect a more specific type (e.g., adapter says
    //    "conversation" but regex detects error_fix pattern → error_fix)
    // 5. Embed: batch via current EmbeddingProvider
    // 6. Store: add to LanceDB with full v2 schema
    // 7. Graph updates: process any edge updates from envelope.raw_metadata
    //    (e.g., git adapter includes TOUCHES/EXPERT_IN edge updates)
    // 8. Distillation queue: enqueue distillable types (decision, error_fix)
  }
}
```

The existing `IngestionPipeline.ingest(messages, context)` is preserved as the internal implementation of the Conversation adapter. It converts `SessionMessage[]` into `SignalEnvelope[]` and feeds them to the unified pipeline.

### Signal Source → Knowledge Type Mapping

New signal sources map to existing knowledge types (no new types needed):

| Signal Source | Primary Types | Mapping Logic |
|--------------|---------------|---------------|
| Git commits | error_fix, decision | Commit message regex: "fix" → error_fix, "refactor/migrate/switch to" → decision |
| PR reviews | preference, pattern, code_pattern | Review comments → preference; approval patterns → pattern |
| Documents (ADRs) | decision | ADRs are decisions by definition |
| Documents (runbooks) | pattern, command | Operational procedures → pattern; shell blocks → command |
| Test signals | error_fix, pattern | Failures → error_fix; flaky patterns → pattern |
| Deployment | error_fix, pattern, decision | Rollbacks → error_fix; deploy practices → pattern |
| Behavioral | pattern, context | Inferred structures → pattern; gap analysis → context |

### Scheduling

| Source | Trigger | Frequency |
|--------|---------|-----------|
| Conversations | Real-time (Stop hook) | Every Claude Code response |
| Git History | Post-commit hook or polling | On commit or every 15 min |
| PR Reviews | GitHub webhook or polling | On PR close/merge |
| Documents | File watcher on docs/** | On file change |
| Test Signals | CI pipeline webhook | On test run completion |
| Deployment | Deploy webhook | On deploy/rollback events |
| Behavioral Inference | Scheduled background job | Daily |

---

## Pillar 6: Gravity System

Bi-directional knowledge flow with evidence-based promotion and decision propagation.

### Bubble-Up: Evidence-Based Promotion

Knowledge becomes a candidate for promotion when:

```
promotion_score = evidence_score × type_weight × freshness
```

**Type weights:** decision (1.5), error_fix (1.3), pattern (1.2), conversation (0.5)

**Promotion thresholds:**
- personal → team: score ≥ 0.6, corroborations ≥ 2, sensitivity ≤ internal
- team → department: score ≥ 0.75, corroborations ≥ 3 (from 2+ teams), sensitivity ≤ internal
- department → organization: score ≥ 0.9, corroborations ≥ 5 (from 2+ depts), sensitivity ≤ internal, no active contradictions

**On promotion:**
1. Knowledge is COPIED (not moved) — original stays with full history
2. Confidence decays per hop: ×0.85
3. Entity links broadened (scoped_to changes)
4. Propagation_path entry recorded
5. Creator notified

### Trickle-Down: Decision Push + Standard Spread

Two modes:
- **PUSH** — copies knowledge into lower scopes. For critical decisions, standards, policy changes. Visible without searching.
- **VISIBILITY** — knowledge accessible at query time via graph proximity but not copied. For general org wisdom, best practices.

| Knowledge type | Default | Override |
|---------------|---------|----------|
| Org decisions | PUSH to all | Policy |
| Security policies | PUSH to affected | Policy |
| Best practices | VISIBILITY | Manual push |
| Standards | PUSH to depts | Policy |
| General patterns | VISIBILITY | — |

### Conflict Detection

Four states:
- **UNRESOLVED** — contradiction exists, no human input. Both surfaced with "[Contested]" flag during retrieval.
- **CONTEXTUAL** — marked as "both valid in different contexts." System serves the context-appropriate one.
- **RESOLVED** — human chose a winner or created synthesis. Loser downranked (evidence_score × 0.3).
- **BLOCKED** — contradicts higher-scope knowledge. Cannot promote until resolved.

Contradiction detection: during ingestion, when a new unit has cosine similarity > `CONTRADICTION_COSINE_THRESHOLD` (0.80) with an existing unit but opposite sentiment/conclusion (keyword analysis). Units in the 0.80-0.90 range are potential contradictions; above 0.90 (`DEDUP_COSINE_THRESHOLD`) they're duplicates.

### Gravity Scheduler

Runs periodically (configurable, default every 6 hours):
1. Scan for promotion candidates (evidence_score changed since last run)
2. Execute pending trickle-down (push queue)
3. Detect new conflicts
4. Decay stale knowledge (reduce evidence for unaccessed units, auto-archive below 0.1 after 6 months)
5. Update graph edge weights (decay inactive EXPERT_IN, strengthen active, prune below threshold)

---

## Phase 4 (Future): Learned Attention Weights

Once Phases 1-3 generate sufficient usage data, layer in learned attention weights that optimize the Context Assembly Engine's weight computation:

- Collect training data: which sources produced results that were actually useful (measured by user behavior after retrieval — did they use the suggested fix? did they ask a follow-up indicating the context was wrong?)
- Train lightweight attention weights per intent category
- The graph provides cold-start structure; attention learns what the graph can't encode
- Transition: graph weights serve as priors, learned weights modulate them

---

## Sub-Project Decomposition

Each pillar is a separate implementation cycle (spec → plan → implement → review):

| # | Sub-Project | Dependencies | Estimated Complexity |
|---|------------|-------------|---------------------|
| 1 | Entity Graph Foundation | None | Medium — SQLite schema, CRUD API, auto-population from users/workspaces |
| 2 | Knowledge Unit Schema Evolution | Pillar 1 | Medium — schema migration, backward-compatible API layer |
| 3 | Context Assembly Engine | Pillars 1, 2 | High — 6-stage pipeline, intent detection, parallel search, fusion |
| 4 | Boundary Engine | Pillars 1, 2 | Medium — auto-classification, policy engine, enforcement layer |
| 5 | Observable Signal Ingestion | Pillars 1, 2, 4 | High — 7 adapters, unified pipeline, scheduling |
| 6 | Gravity System | All above | High — promotion logic, trickle-down, conflict detection, scheduler |

Pillars 1-2 can be built in parallel. Pillars 3-4 can be built in parallel after 1-2 complete. Pillars 5-6 depend on all prior work.

---

## Degraded / Cold-Start Behavior

The system must degrade gracefully when the graph is incomplete:

- **No graph (fresh install):** Context Assembly Engine falls back to v1 flat-layer behavior (search personal, then workspace, then team with fixed weights). No promotion, no policies, no entity resolution.
- **Single user, no teams:** Scope is always `personal`. Promotion thresholds adapt: "2+ teams" becomes "2+ independent sessions" (the user corroborates their own knowledge across separate conversations). Trickle-down is a no-op.
- **No knowledge units:** RAG hook returns empty context silently (already handles this). Learn hook operates normally, building the knowledge base from scratch.
- **Sparse graph (some entities, few edges):** Graph proximity falls back to scope-level distance when no path exists between entities (personal=0, same team=1, same dept=2, same org=3). Edge weights default to 0.5 when not computed from signals.

## MCP Tool Backward Compatibility

The `cortex_teach` MCP tool and all API endpoints accept both old and new parameters:
- `--layer personal` maps internally to `scope: { level: "personal", entity_id: "{current-user}" }`
- New parameters `--scope`, `--sensitivity`, `--grant` are added alongside old ones
- Existing hooks (`cortex-hook.js`, `cortex-learn-hook.js`) continue working unchanged; enhanced versions are opt-in

## Gravity Scheduler Implementation

The Gravity Scheduler runs as a `setInterval` timer within the Spaces Node.js process (consistent with `FederationSync.start()`). On process restart, it resumes from the last checkpoint stored in SQLite (`gravity_state` table with `last_run` timestamp). Incomplete cycles are idempotent — re-running a promotion scan or decay pass produces the same result.

## Success Criteria

- Retrieval latency remains <150ms (current: ~50ms single-source)
- Knowledge from the right source surfaces first (measured by graph-distance correlation with user satisfaction)
- Confidential knowledge never leaks across scope boundaries (verified by audit trail)
- Evidence-based promotion reduces noise in higher scopes (measured by corroboration ratio)
- New signal sources can be added by implementing a single adapter interface
- Conflict surfacing reduces silent contradictions (measured by unresolved conflict count trending down)
- Existing 542+ units migrate without data loss, old API stays backward compatible
