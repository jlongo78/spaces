import crypto from 'crypto';
import type { EmbeddingProvider } from '../embeddings';
import type { CortexStore } from '../store';
import type { KnowledgeUnit, RawChunk } from '../knowledge/types';
import { getConfidenceBase } from '../knowledge/types';
import { chunkMessages, type SessionMessage, type ChunkContext } from './chunker';

export interface IngestionResult {
  chunksCreated: number;
  chunksEmbedded: number;
  chunksSkipped: number;
  errors: string[];
}

export class IngestionPipeline {
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

    // Tier 2: Embed and store
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => c.text);

      try {
        const vectors = await this.embedding.embed(texts);

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const layerKey = chunk.layer === 'workspace' && chunk.workspace_id
            ? `workspace/${chunk.workspace_id}`
            : chunk.layer;

          const unit: KnowledgeUnit = {
            id: crypto.randomUUID(),
            vector: vectors[j],
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
        }
      } catch (err) {
        result.errors.push(`Tier 2 batch error: ${err}`);
        result.chunksSkipped += batch.length;
      }
    }

    return result;
  }
}
