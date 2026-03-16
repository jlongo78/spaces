import type { KnowledgeType, SensitivityClass, Origin, EntityLink } from '../knowledge/types';

export interface SignalEnvelope {
  text: string;
  origin: Origin;
  entities: EntityLink[];
  suggested_type: KnowledgeType;
  suggested_sensitivity: SensitivityClass;
  raw_metadata: Record<string, unknown>;
}

export interface SignalAdapter {
  name: string;
  schedule: 'realtime' | 'polling' | 'webhook' | 'cron';
  extract(): AsyncIterable<SignalEnvelope>;
  healthCheck(): Promise<boolean>;
}

export interface IngestResult {
  accepted: number;
  skipped: number;     // dedup
  errors: string[];
}

/**
 * Graph edge update carried in raw_metadata.
 * Adapters can include these to update the entity graph during ingestion.
 */
export interface EdgeUpdate {
  source_id: string;
  target_id: string;
  relation: string;
  weight_delta: number;  // increment (not absolute)
}
