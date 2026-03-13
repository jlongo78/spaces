import fs from 'fs';
import path from 'path';
import type { CortexStore } from '../store';
import type { KnowledgeUnit, ScoredKnowledge, Layer } from '../knowledge/types';
import { computeRelevanceScore } from './scoring';
import { computeFileStaleScore } from '../knowledge/staleness';

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

export interface SearchDeps {
  fileStat?: (filepath: string) => Promise<{ mtime: Date } | null>;
}

async function defaultFileStat(filepath: string): Promise<{ mtime: Date } | null> {
  try {
    const stat = await fs.promises.stat(filepath);
    return { mtime: stat.mtime };
  } catch {
    return null;
  }
}

export class CortexSearch {
  private fileStat: (filepath: string) => Promise<{ mtime: Date } | null>;

  constructor(private store: CortexStore, deps: SearchDeps = {}) {
    this.fileStat = deps.fileStat ?? defaultFileStat;
  }

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

    // Compute staleness on top candidates (cache stat calls per search request)
    const candidates = allResults
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, limit * 2);

    const statCache = new Map<string, { mtime: Date } | null>();
    const cachedFileStat = async (fp: string) => {
      if (!statCache.has(fp)) statCache.set(fp, await this.fileStat(fp));
      return statCache.get(fp)!;
    };

    for (const result of candidates) {
      const staleScore = await this.computeStaleness(result, cachedFileStat);
      if (staleScore > 0) {
        result.stale_score = staleScore;
        // Recompute relevance with staleness
        result.relevance_score = computeRelevanceScore({
          similarity: result.similarity,
          confidence: result.confidence,
          stale_score: staleScore,
          created: result.created,
        }) * (LAYER_WEIGHTS[result.layer] ?? 0.5);
      }
    }

    candidates.sort((a, b) => b.relevance_score - a.relevance_score);
    return candidates.slice(0, limit);
  }

  private async computeStaleness(
    unit: KnowledgeUnit & { similarity: number },
    statFn?: (fp: string) => Promise<{ mtime: Date } | null>,
  ): Promise<number> {
    if (unit.file_refs.length === 0) return 0;
    const doStat = statFn ?? this.fileStat;

    const fileModTimes: Record<string, string> = {};
    for (const ref of unit.file_refs) {
      const fullPath = unit.project_path ? path.join(unit.project_path, ref) : ref;
      try {
        const stat = await doStat(fullPath);
        if (stat) fileModTimes[ref] = stat.mtime.toISOString();
      } catch { /* file doesn't exist or not accessible */ }
    }

    return computeFileStaleScore({
      fileRefs: unit.file_refs,
      sourceTimestamp: unit.source_timestamp,
      fileModTimes,
    });
  }
}
