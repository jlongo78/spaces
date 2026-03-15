import { HAS_CORTEX } from '@/lib/tier';
import { getUserPaths } from '@/lib/config';
import { getCurrentUser } from '@/lib/auth';
import { CortexStore } from './store';
import { readCortexConfig, type CortexConfig } from './config';
import { detectProvider, type EmbeddingProvider } from './embeddings';
import { CortexSearch } from './retrieval/search';
import { IngestionPipeline } from './ingestion/pipeline';
import { FederationSync } from './retrieval/sync';
import { Distiller } from './distillation/distiller';
import { DistillationScheduler } from './distillation/scheduler';
import { DistillationQueue } from './distillation/queue';
import { createCallLLM } from './distillation/llm';
import { EntityGraph } from './graph/entity-graph';
import { ContextEngine } from './retrieval/context-engine';
import { EntityResolver } from './graph/resolver';
import path from 'path';

let _instance: CortexInstance | null = null;

export interface CortexInstance {
  config: CortexConfig;
  store: CortexStore;
  search: CortexSearch;
  pipeline: IngestionPipeline;
  embedding: EmbeddingProvider;
  graph: EntityGraph;
  contextEngine?: ContextEngine;
  sync?: FederationSync;
  distillQueue?: DistillationQueue;
  distillScheduler?: DistillationScheduler;
}

export function isCortexAvailable(): boolean {
  return HAS_CORTEX;
}

export async function getCortex(): Promise<CortexInstance | null> {
  if (!HAS_CORTEX) return null;

  if (_instance) return _instance;

  const username = getCurrentUser();
  const { spacesDir, configPath } = getUserPaths(username);
  const config = readCortexConfig(configPath);

  if (!config.enabled) return null;

  const cortexDir = path.join(spacesDir, 'cortex');
  const store = new CortexStore(cortexDir);
  const embedding = await detectProvider(config.embedding.provider);
  await store.init(embedding.dimensions);

  const graphPath = path.join(cortexDir, 'graph.db');
  const graph = new EntityGraph(graphPath);

  const search = new CortexSearch(store);
  const pipeline = new IngestionPipeline(embedding, store);

  const resolver = new EntityResolver(graph);
  const contextEngine = new ContextEngine({
    store,
    graph,
    resolver,
    embedding,
    requesterId: 'person-default-user',
  });

  // Initialize distillation if enabled and LLM provider available
  let distillQueue: DistillationQueue | undefined;
  let distillScheduler: DistillationScheduler | undefined;

  if (config.ingestion.distillation) {
    const callLLM = createCallLLM();
    if (callLLM) {
      distillQueue = new DistillationQueue(cortexDir);
      const distiller = new Distiller(store, embedding, callLLM);

      distillScheduler = new DistillationScheduler(async (chunkIds) => {
        const entries = distillQueue!.getEntries(chunkIds);
        if (entries.length === 0) return;

        // Group by layerKey so workspace chunks go to the correct layer
        const byLayer = new Map<string, { texts: string[]; ctx: { workspaceId: number | null; agentType: string } }>();
        for (const e of entries) {
          if (!byLayer.has(e.layerKey)) {
            byLayer.set(e.layerKey, { texts: [], ctx: { workspaceId: e.workspaceId, agentType: e.agentType } });
          }
          byLayer.get(e.layerKey)!.texts.push(e.text);
        }

        for (const [layerKey, { texts, ctx }] of byLayer) {
          await distiller.distill(texts, layerKey, ctx);
        }
        distillQueue!.remove(chunkIds);
      });

      // Re-enqueue any pending items from previous session
      const pendingIds = distillQueue.pendingIds();
      if (pendingIds.length > 0) {
        distillScheduler.enqueue(pendingIds);
      }

      pipeline.distillQueue = distillQueue;
      pipeline.distillScheduler = distillScheduler;
    }
  }

  const instance: CortexInstance = {
    config, store, search, pipeline, embedding, graph,
    contextEngine,
    distillQueue, distillScheduler,
  };

  // Initialize background federation sync if enabled
  if (config.federation.sync_mode === 'background-sync') {
    const syncIntervalMs = config.federation.sync_interval_minutes * 60 * 1000;
    const sync = new FederationSync(store, embedding, {
      intervalMs: syncIntervalMs,
      connectedNodes: [], // Will be populated by network module
      timeoutMs: config.federation.query_timeout_ms,
    });
    sync.start();
    instance.sync = sync;
  }

  _instance = instance;
  return _instance;
}

export function resetCortex(): void {
  if (_instance?.sync) {
    _instance.sync.stop();
  }
  if (_instance?.distillScheduler) {
    _instance.distillScheduler.stop();
  }
  if (_instance?.graph) {
    _instance.graph.close();
  }
  _instance = null;
}
