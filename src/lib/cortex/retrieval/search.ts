import type { CortexStore } from '../store';
import type { KnowledgeUnit, ScoredKnowledge, Layer } from '../knowledge/types';
import { computeRelevanceScore } from './scoring';

const LAYER_WEIGHTS: Record<Layer, number> = {
  personal: 1.0,
  workspace: 0.9,
  team: 0.7,
};

export interface SearchOptions {
  workspaceId?: number | null;
  layers?: Layer[];
  excludeLayers?: Layer[];
  types?: string[];
  limit?: number;
  minConfidence?: number;
}

export class CortexSearch {
  constructor(private store: CortexStore) {}

  async search(
    queryVector: number[],
    options: SearchOptions = {},
  ): Promise<ScoredKnowledge[]> {
    const {
      workspaceId = null,
      layers = ['personal', 'workspace', 'team'],
      excludeLayers = [],
      limit = 5,
      minConfidence = 0.3,
    } = options;

    const allResults: ScoredKnowledge[] = [];
    const activeLayers = layers.filter(l => !excludeLayers.includes(l));

    for (const layer of activeLayers) {
      const layerKey = layer === 'workspace' && workspaceId
        ? `workspace/${workspaceId}`
        : layer;

      try {
        const results = await this.store.search(layerKey, queryVector, limit * 2);
        const weight = LAYER_WEIGHTS[layer] ?? 0.5;

        for (const unit of results) {
          const similarity = 1 - ((unit as any)._distance ?? 0);
          const relevance = computeRelevanceScore({
            similarity,
            confidence: unit.confidence,
            stale_score: unit.stale_score,
            created: unit.created,
          }) * weight;

          if (unit.confidence >= minConfidence) {
            allResults.push({
              ...unit,
              relevance_score: relevance,
              similarity,
            });
          }
        }
      } catch {
        // Layer may not exist yet, skip
      }
    }

    allResults.sort((a, b) => b.relevance_score - a.relevance_score);
    return allResults.slice(0, limit);
  }
}
