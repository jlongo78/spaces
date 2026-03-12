import { HAS_CORTEX } from '@/lib/tier';
import { getUserPaths } from '@/lib/config';
import { getCurrentUser } from '@/lib/auth';
import { CortexStore } from './store';
import { readCortexConfig, type CortexConfig } from './config';
import { detectProvider, type EmbeddingProvider } from './embeddings';
import { CortexSearch } from './retrieval/search';
import { IngestionPipeline } from './ingestion/pipeline';
import path from 'path';

let _instance: CortexInstance | null = null;

export interface CortexInstance {
  config: CortexConfig;
  store: CortexStore;
  search: CortexSearch;
  pipeline: IngestionPipeline;
  embedding: EmbeddingProvider;
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

  _instance = { config, store, search, pipeline, embedding };
  return _instance;
}

export function resetCortex(): void {
  _instance = null;
}
