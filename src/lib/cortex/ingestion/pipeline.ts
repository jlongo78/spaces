import crypto from 'crypto';
import type { EmbeddingProvider } from '../embeddings';
import type { CortexStore } from '../store';
import type { KnowledgeUnit, RawChunk } from '../knowledge/types';
import { getConfidenceBase } from '../knowledge/types';
import { chunkMessages, type SessionMessage, type ChunkContext } from './chunker';
import { textHash } from './deduplicator';
import { detectErrorFixPairs, extractDecisionPatterns, extractCommands } from './extractors';
import type { DistillationQueue } from '../distillation/queue';
import type { DistillationScheduler } from '../distillation/scheduler';

export interface IngestionResult {
  chunksCreated: number;
  chunksEmbedded: number;
  chunksSkipped: number;
  errors: string[];
}

const COSINE_DEDUP_THRESHOLD = 0.05;
const DISTILLABLE_TYPES = new Set(['decision', 'error_fix']);

export class IngestionPipeline {
  private hashSet = new Set<string>();
  distillQueue?: DistillationQueue;
  distillScheduler?: DistillationScheduler;

  constructor(
    private embedding: EmbeddingProvider,
    private store: CortexStore,
  ) {}

  async ingest(
    messages: SessionMessage[],
    ctx: ChunkContext,
  ): Promise<IngestionResult> {
    const result: IngestionResult = {
      chunksCreated: 0, chunksEmbedded: 0, chunksSkipped: 0, errors: [],
    };

    // Tier 1: Fast pass — chunk messages
    let chunks: RawChunk[];
    try {
      chunks = chunkMessages(messages, ctx);
    } catch (err) {
      result.errors.push(`Tier 1 error: ${err}`);
      return result;
    }
    result.chunksCreated = chunks.length;

    // Tier 1.5: Classify chunks via regex extractors
    this.classifyChunks(chunks);

    // Tier 1.5: Hash dedup (pre-embed) — skip embedding for exact matches
    const novel: RawChunk[] = [];
    for (const chunk of chunks) {
      const hash = textHash(chunk.text);
      if (this.hashSet.has(hash)) {
        result.chunksSkipped++;
      } else {
        this.hashSet.add(hash);
        novel.push(chunk);
      }
    }

    // Tier 2: Embed and store (with cosine dedup post-embed)
    const BATCH_SIZE = 50;
    for (let i = 0; i < novel.length; i += BATCH_SIZE) {
      const batch = novel.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => c.text);

      try {
        const vectors = await this.embedding.embed(texts);

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const vector = vectors[j];
          const layerKey = chunk.layer === 'workspace' && chunk.workspace_id
            ? `workspace/${chunk.workspace_id}`
            : chunk.layer;

          // Cosine dedup (post-embed): check for near matches in store
          try {
            const neighbors = await this.store.search(layerKey, vector, 1);
            if (
              neighbors.length > 0 &&
              typeof (neighbors[0] as any)._distance === 'number' &&
              (neighbors[0] as any)._distance < COSINE_DEDUP_THRESHOLD
            ) {
              await this.store.updateAccessCount(layerKey, neighbors[0].id);
              result.chunksSkipped++;
              continue;
            }
          } catch {
            // If search fails, proceed to store — don't block ingestion
          }

          const unit: KnowledgeUnit = {
            id: crypto.randomUUID(),
            vector,
            text: chunk.text,
            type: chunk.type,
            layer: chunk.layer,
            workspace_id: chunk.workspace_id,
            session_id: chunk.session_id,
            agent_type: chunk.agent_type,
            project_path: chunk.project_path,
            file_refs: chunk.file_refs,
            confidence: getConfidenceBase(chunk.type),
            created: new Date().toISOString(),
            source_timestamp: chunk.source_timestamp,
            stale_score: 0,
            access_count: 0,
            last_accessed: null,
            metadata: chunk.metadata,
          };

          await this.store.add(layerKey, unit);
          result.chunksEmbedded++;

          // Enqueue for distillation if the type qualifies
          if (this.distillQueue && this.distillScheduler && DISTILLABLE_TYPES.has(unit.type)) {
            this.distillQueue.enqueue(unit.id, {
              text: unit.text,
              layerKey,
              workspaceId: unit.workspace_id,
              agentType: unit.agent_type,
            });
            this.distillScheduler.enqueue([unit.id]);
          }
        }
      } catch (err) {
        result.errors.push(`Tier 2 batch error: ${err}`);
        result.chunksSkipped += batch.length;
      }
    }

    return result;
  }

  /** Enrich chunk types using regex extractors. Mutates chunks in place. */
  private classifyChunks(chunks: RawChunk[]): void {
    for (const chunk of chunks) {
      const errorFixes = detectErrorFixPairs(chunk.text);
      const decisions = extractDecisionPatterns(chunk.text);
      const commands = extractCommands(chunk.text);

      // Priority: decision > error_fix > conversation (default)
      if (decisions.length > 0) {
        chunk.type = 'decision';
        chunk.metadata.decisions = decisions;
      } else if (errorFixes.length > 0) {
        chunk.type = 'error_fix';
        chunk.metadata.error_fixes = errorFixes;
      }

      if (commands.length > 0) {
        chunk.metadata.commands = commands;
      }
    }
  }
}
