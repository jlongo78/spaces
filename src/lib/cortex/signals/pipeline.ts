import { createHash } from 'crypto';
import type { CortexStore } from '../store';
import type { EmbeddingProvider } from '../embeddings';
import type { EntityGraph } from '../graph/entity-graph';
import type { EntityResolver } from '../graph/resolver';
import type { KnowledgeUnit } from '../knowledge/types';
import { classifySensitivity } from '../boundary/classifier';
import { layerToScope, scopeToLayerKey } from '../knowledge/compat';
import type { SignalEnvelope, IngestResult, EdgeUpdate } from './types';

const SENSITIVITY_PRIORITY: Record<string, number> = {
  public: 0, internal: 1, restricted: 2, confidential: 3,
};

export interface SignalPipelineDeps {
  store: CortexStore;
  embedding: EmbeddingProvider;
  graph: EntityGraph;
  resolver: EntityResolver;
}

export class SignalPipeline {
  private hashSet = new Set<string>();
  private deps: SignalPipelineDeps;

  constructor(deps: SignalPipelineDeps) {
    this.deps = deps;
  }

  async ingest(envelope: SignalEnvelope): Promise<IngestResult> {
    const result: IngestResult = { accepted: 0, skipped: 0, errors: [] };

    try {
      // 1. Dedup by SHA-256 hash of normalized text
      const hash = createHash('sha256')
        .update(envelope.text.replace(/\s+/g, ' ').trim())
        .digest('hex');

      if (this.hashSet.has(hash)) {
        result.skipped = 1;
        return result;
      }
      this.hashSet.add(hash);

      // 2. Sensitivity: most restrictive wins between suggested and auto-classified
      const autoSensitivity = classifySensitivity(envelope.text);
      const suggestedPriority = SENSITIVITY_PRIORITY[envelope.suggested_sensitivity] ?? 1;
      const autoPriority = SENSITIVITY_PRIORITY[autoSensitivity] ?? 1;
      const sensitivity = suggestedPriority >= autoPriority
        ? envelope.suggested_sensitivity
        : autoSensitivity;

      // 3. Embed text
      const [vector] = await this.deps.embedding.embed([envelope.text]);

      // 4. Build scope from origin
      const userId = envelope.origin.creator_entity_id.replace(/^person-/, '');
      const scope = layerToScope('personal', null, userId);
      const layerKey = scopeToLayerKey(scope);
      const layer = 'personal' as const;

      // 5. Build KnowledgeUnit with v2 fields
      const unit: KnowledgeUnit = {
        id: crypto.randomUUID(),
        vector,
        text: envelope.text,
        type: envelope.suggested_type,
        layer,
        workspace_id: (envelope.raw_metadata.workspace_id as number) ?? null,
        session_id: (envelope.raw_metadata.session_id as string) ?? null,
        agent_type: 'claude',
        project_path: (envelope.raw_metadata.project_path as string) ?? null,
        file_refs: (envelope.raw_metadata.file_refs as string[]) ?? [],
        confidence: 0.8,
        created: new Date().toISOString(),
        source_timestamp: new Date().toISOString(),
        stale_score: 0,
        access_count: 0,
        last_accessed: null,
        metadata: { source: envelope.origin.source_type },
        // v2 fields
        scope,
        entity_links: envelope.entities,
        evidence_score: 0.8,
        corroborations: 0,
        contradiction_refs: [],
        sensitivity,
        creator_scope: null,
        origin: envelope.origin,
        propagation_path: [],
      };

      // 6. Store via store.add(layerKey, unit)
      await this.deps.store.add(layerKey, unit);
      result.accepted = 1;

      // 7. Process edge_updates from raw_metadata
      const edgeUpdates = (envelope.raw_metadata.edge_updates as EdgeUpdate[]) ?? [];
      for (const update of edgeUpdates) {
        try {
          this.deps.graph.incrementEdgeWeight(
            update.source_id,
            update.target_id,
            update.relation as any,
            update.weight_delta,
          );
        } catch {
          // Edge entities may not exist yet — skip silently
        }
      }

    } catch (err: any) {
      result.errors.push(err.message ?? String(err));
    }

    return result;
  }

  async ingestBatch(envelopes: SignalEnvelope[]): Promise<IngestResult> {
    const totals: IngestResult = { accepted: 0, skipped: 0, errors: [] };
    for (const envelope of envelopes) {
      const r = await this.ingest(envelope);
      totals.accepted += r.accepted;
      totals.skipped += r.skipped;
      totals.errors.push(...r.errors);
    }
    return totals;
  }
}
