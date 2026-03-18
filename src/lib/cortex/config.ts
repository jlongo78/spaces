/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from './index';

export interface CortexConfig {
  enabled: boolean;
  debug: boolean;
  anthropic_api_key?: string;
  openai_api_key?: string;
  embedding: any;
  injection: any;
  ingestion: any;
  layers: any;
  staleness: any;
  federation: any;
  storage: any;
  policies?: any[];
}

export const DEFAULT_CORTEX_CONFIG: CortexConfig = {
  enabled: false,
  debug: false,
  anthropic_api_key: '',
  openai_api_key: '',
  embedding: { provider: 'auto', model: null, fallback: 'local', dimensions: null },
  injection: { enabled: true, max_tokens: 5000, max_results: 10, min_confidence: 0.3 },
  ingestion: { auto_ingest: true, distillation: true, distillation_model: 'auto' },
  layers: { personal: true, workspace: true, team: true },
  staleness: { decision_halflife_days: 180, pattern_halflife_days: 90, context_halflife_days: 30, conversation_halflife_days: 14 },
  federation: { sync_mode: 'query-only', sync_interval_minutes: 5, query_timeout_ms: 500 },
  storage: { max_size_mb: 2048, warning_threshold_mb: 500 },
  policies: [],
};

export function readCortexConfig(configPath: string): CortexConfig {
  return getCortexAddon()?.readCortexConfig(configPath) ?? { ...DEFAULT_CORTEX_CONFIG };
}

export function writeCortexConfig(configPath: string, updates: Partial<CortexConfig>): void {
  getCortexAddon()?.writeCortexConfig(configPath, updates);
}
