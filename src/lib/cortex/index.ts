import { HAS_CORTEX } from '@/lib/tier';
import { getUserPaths } from '@/lib/config';
import { getCurrentUser } from '@/lib/auth';
import { CortexStore } from './store';
import { readCortexConfig, type CortexConfig } from './config';
import { detectProvider, type EmbeddingProvider } from './embeddings';
import { CortexSearch } from './retrieval/search';
import { IngestionPipeline } from './ingestion/pipeline';
import { FederationSync } from './retrieval/sync';
import path from 'path';

let _instance: CortexInstance | null = null;

export interface CortexInstance {
  config: CortexConfig;
  store: CortexStore;
  search: CortexSearch;
  pipeline: IngestionPipeline;
  embedding: EmbeddingProvider;
  sync?: FederationSync;
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

  const search = new CortexSearch(store);
  const pipeline = new IngestionPipeline(embedding, store);

  const instance: CortexInstance = { config, store, search, pipeline, embedding };

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
  _instance = null;
}
