import fs from 'fs';

export interface CortexConfig {
  enabled: boolean;
  embedding: {
    provider: 'auto' | 'voyage' | 'openai' | 'local';
    model: string | null;
    fallback: 'local';
    dimensions: number | null;  // null = auto-detect from provider
  };
  injection: {
    enabled: boolean;
    max_tokens: number;
    max_results: number;
    min_confidence: number;
  };
  ingestion: {
    auto_ingest: boolean;
    distillation: boolean;
    distillation_model: 'auto' | string;
  };
  layers: {
    personal: boolean;
    workspace: boolean;
    team: boolean;
  };
  staleness: {
    decision_halflife_days: number;
    pattern_halflife_days: number;
    context_halflife_days: number;
    conversation_halflife_days: number;
  };
  federation: {
    sync_mode: 'query-only' | 'background-sync' | 'real-time-sync';
    sync_interval_minutes: number;
    query_timeout_ms: number;
  };
  storage: {
    max_size_mb: number;
    warning_threshold_mb: number;
  };
}

export const DEFAULT_CORTEX_CONFIG: CortexConfig = {
  enabled: true,
  embedding: { provider: 'auto', model: null, fallback: 'local', dimensions: null },
  injection: { enabled: true, max_tokens: 2000, max_results: 5, min_confidence: 0.3 },
  ingestion: { auto_ingest: true, distillation: true, distillation_model: 'auto' },
  layers: { personal: true, workspace: true, team: true },
  staleness: {
    decision_halflife_days: 180,
    pattern_halflife_days: 90,
    context_halflife_days: 30,
    conversation_halflife_days: 14,
  },
  federation: { sync_mode: 'query-only', sync_interval_minutes: 5, query_timeout_ms: 500 },
  storage: { max_size_mb: 2048, warning_threshold_mb: 500 },
};

/** Deep-merge defaults with partial config. */
function mergeDefaults(partial: Record<string, any>): CortexConfig {
  const result = JSON.parse(JSON.stringify(DEFAULT_CORTEX_CONFIG));
  for (const [key, value] of Object.entries(partial)) {
    if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) && key in result) {
      result[key] = { ...result[key], ...value };
    } else if (key in result && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** Read cortex config from a spaces config.json file. */
export function readCortexConfig(configPath: string): CortexConfig {
  try {
    if (fs.existsSync(configPath)) {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (raw.cortex && typeof raw.cortex === 'object') {
        return mergeDefaults(raw.cortex);
      }
    }
  } catch { /* corrupt file, return defaults */ }
  return { ...DEFAULT_CORTEX_CONFIG };
}

/** Write cortex config, preserving all other keys in the file. */
export function writeCortexConfig(configPath: string, updates: Partial<CortexConfig>): void {
  let existing: Record<string, any> = {};
  try {
    if (fs.existsSync(configPath)) {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* corrupt, overwrite */ }

  const currentCortex = existing.cortex && typeof existing.cortex === 'object'
    ? mergeDefaults(existing.cortex)
    : { ...DEFAULT_CORTEX_CONFIG };

  // Shallow merge updates into current cortex config
  for (const [key, value] of Object.entries(updates)) {
    if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value) && key in currentCortex) {
      (currentCortex as any)[key] = { ...(currentCortex as any)[key], ...value };
    } else if (key in currentCortex && value !== undefined) {
      (currentCortex as any)[key] = value;
    }
  }

  existing.cortex = currentCortex;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
}
