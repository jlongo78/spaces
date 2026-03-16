import type { CortexStore } from '../store';
import type { EntityGraph } from '../graph/entity-graph';
import type { EntityResolver, ResolvedEntity } from '../graph/resolver';
import type { EmbeddingProvider } from '../embeddings/index';
import type { KnowledgeUnit, ScoredKnowledge } from '../knowledge/types';
import { detectIntent } from './intent';
import type { DetectedIntent as IntentResult } from './intent';
import { computeScopeWeight, computeTypeBoost } from './weight';
import { detectConflicts } from './conflict';
import type { ConflictPair } from './conflict';
import { formatContext } from './formatter';
import { computeRelevanceScore } from './scoring';
import { AccessFilter } from '../boundary/access';

export type { IntentResult };

export interface ContextEngineDeps {
  store: CortexStore;
  graph: EntityGraph;
  resolver: EntityResolver;
  embedding: EmbeddingProvider;
  requesterId: string;
  accessFilter?: AccessFilter;
}

export interface AssemblyResult {
  results: ScoredKnowledge[];
  conflicts: ConflictPair[];
  context: string;
  intent: IntentResult;
  entities: ResolvedEntity[];
  timing: { intentMs: number; entityMs: number; searchMs: number; totalMs: number };
}

interface SourceConfig {
  layerKey: string;
  scopeLevel: string;
  layerEntity: string;
  slots: number;
  weight: number;
}

export class ContextEngine {
  constructor(private deps: ContextEngineDeps) {}

  async assemble(
    query: string,
    options?: { limit?: number; workspaceId?: number | null; maxTokens?: number },
  ): Promise<AssemblyResult> {
    const totalStart = Date.now();
    const limit = options?.limit ?? 10;
    const workspaceId = options?.workspaceId ?? null;
    const maxTokens = options?.maxTokens ?? 2000;

    // Stage 1: Detect intent
    const intentStart = Date.now();
    const intent = detectIntent(query);
    const intentMs = Date.now() - intentStart;

    // Stage 2: Extract entities
    const entityStart = Date.now();
    const entities = this.deps.resolver.extractEntities(query);
    const entityMs = Date.now() - entityStart;

    // Embed the query
    const vectors = await this.deps.embedding.embed([query]);
    const queryVector = vectors[0];

    // Stage 3: Compute source weights per layer
    const sources = this.computeSourceWeights(intent, workspaceId);

    // Stage 4: Parallel search with 100ms timeout per source
    const searchStart = Date.now();
    const rawResults = await this.parallelSearch(queryVector, sources);
    const searchMs = Date.now() - searchStart;

    // Stage 5: Fuse and rank results
    const fused = this.fuseAndRank(rawResults, intent, limit);

    // Stage 5.5: Access control filtering
    let accessible = fused;
    if (this.deps.accessFilter) {
      accessible = this.deps.accessFilter.filterResults(fused);
    }

    // Stage 6: Detect conflicts and format context
    const conflicts = detectConflicts(accessible);
    const context = formatContext(accessible, conflicts, { maxTokens });

    const totalMs = Date.now() - totalStart;

    return {
      results: accessible,
      conflicts,
      context,
      intent,
      entities,
      timing: { intentMs, entityMs, searchMs, totalMs },
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * For each of the 3 layers, compute a scope weight using graph proximity and
   * intent biases. Returns an array of SourceConfig with layer keys and slot counts.
   */
  private computeSourceWeights(
    intent: IntentResult,
    workspaceId: number | null,
  ): SourceConfig[] {
    const layerDefs = [
      { layer: 'personal' as const, scopeLevel: 'personal', layerEntity: 'layer-personal', defaultProximity: 1.0 },
      { layer: 'workspace' as const, scopeLevel: 'team', layerEntity: 'layer-workspace', defaultProximity: 0.5 },
      { layer: 'team' as const, scopeLevel: 'organization', layerEntity: 'layer-team', defaultProximity: 0.33 },
    ];

    return layerDefs.map(({ layer, scopeLevel, layerEntity, defaultProximity }) => {
      const rawProximity = this.deps.graph.proximity(this.deps.requesterId, layerEntity);
      const graphProximity = rawProximity > 0 ? rawProximity : defaultProximity;

      const weight = computeScopeWeight({
        graphProximity,
        scopeLevel,
        intentBiases: intent.biases,
        authorityFactor: 1.0,
      });

      const slots = Math.max(3, Math.round(weight * 10));

      const layerKey =
        layer === 'workspace' && workspaceId ? `workspace/${workspaceId}` : layer;

      return { layerKey, scopeLevel, layerEntity, slots, weight };
    });
  }

  /**
   * Search all sources concurrently. Each source search races against a 100ms
   * timeout. Failures and timeouts return empty arrays without blocking.
   */
  private async parallelSearch(
    queryVector: number[],
    sources: SourceConfig[],
  ): Promise<Array<{ unit: KnowledgeUnit; similarity: number; sourceWeight: number }>> {
    const timeout = (ms: number): Promise<never> =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('search timeout')), ms),
      );

    const searches = sources.map(source =>
      Promise.race([
        this.deps.store.search(source.layerKey, queryVector, source.slots),
        timeout(100),
      ])
        .then(units =>
          (units as KnowledgeUnit[]).map(unit => ({
            unit,
            similarity: 1 - ((unit as any)._distance ?? 0),
            sourceWeight: source.weight,
          })),
        )
        .catch(() => [] as Array<{ unit: KnowledgeUnit; similarity: number; sourceWeight: number }>),
    );

    const settled = await Promise.allSettled(searches);
    const all: Array<{ unit: KnowledgeUnit; similarity: number; sourceWeight: number }> = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        all.push(...result.value);
      }
    }

    return all;
  }

  /**
   * Score each result, deduplicate, sort and take top K.
   */
  private fuseAndRank(
    rawResults: Array<{ unit: KnowledgeUnit; similarity: number; sourceWeight: number }>,
    intent: IntentResult,
    limit: number,
  ): ScoredKnowledge[] {
    const scored: ScoredKnowledge[] = rawResults.map(({ unit, similarity, sourceWeight }) => {
      const typeBoost = computeTypeBoost(unit.type, intent.biases);
      // computeRelevanceScore internally applies recency boost — don't multiply again
      const base = computeRelevanceScore({
        similarity,
        confidence: unit.confidence,
        stale_score: unit.stale_score,
        created: unit.created,
        evidence_score: unit.evidence_score,
      });
      const relevance_score = base * sourceWeight * typeBoost;

      return { ...unit, relevance_score, similarity };
    });

    // Sort descending so deduplication keeps the highest-scored version
    scored.sort((a, b) => b.relevance_score - a.relevance_score);

    const deduped = this.deduplicateResults(scored);
    return deduped.slice(0, limit);
  }

  /**
   * Deduplicate by ID and by normalized text prefix (first 200 chars, lowercased,
   * trimmed). Keeps the first (highest-scored) occurrence of each.
   */
  private deduplicateResults(results: ScoredKnowledge[]): ScoredKnowledge[] {
    const seenIds = new Set<string>();
    const seenPrefixes = new Set<string>();
    const kept: ScoredKnowledge[] = [];

    for (const result of results) {
      if (seenIds.has(result.id)) continue;

      const prefix = result.text.toLowerCase().trim().slice(0, 200);
      if (seenPrefixes.has(prefix)) continue;

      seenIds.add(result.id);
      seenPrefixes.add(prefix);
      kept.push(result);
    }

    return kept;
  }
}
