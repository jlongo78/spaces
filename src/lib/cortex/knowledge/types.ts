// ─── Knowledge Types ─────────────────────────────────────────

export const KNOWLEDGE_TYPES = [
  'decision', 'pattern', 'preference', 'error_fix',
  'context', 'code_pattern', 'command', 'conversation', 'summary',
] as const;
export type KnowledgeType = typeof KNOWLEDGE_TYPES[number];

export const LAYERS = ['personal', 'workspace', 'team'] as const;
export type Layer = typeof LAYERS[number];

export type AgentType = 'claude' | 'codex' | 'gemini' | 'aider';

export function isValidKnowledgeType(s: string): s is KnowledgeType {
  return (KNOWLEDGE_TYPES as readonly string[]).includes(s);
}

export function isValidLayer(s: string): s is Layer {
  return (LAYERS as readonly string[]).includes(s);
}

// ─── Confidence & Staleness Defaults ─────────────────────────

const CONFIDENCE_BASE: Record<KnowledgeType, number> = {
  decision: 0.8, pattern: 0.8, preference: 0.95, error_fix: 0.8,
  context: 0.6, code_pattern: 0.7, command: 0.6, conversation: 0.4, summary: 0.6,
};

const HALFLIFE_DAYS: Record<KnowledgeType, number> = {
  decision: 180, pattern: 90, preference: 180, error_fix: 90,
  context: 30, code_pattern: 60, command: 30, conversation: 14, summary: 60,
};

export function getConfidenceBase(type: KnowledgeType): number {
  return CONFIDENCE_BASE[type];
}

export function getHalflifeDays(type: KnowledgeType): number {
  return HALFLIFE_DAYS[type];
}

// ─── Core Interfaces ─────────────────────────────────────────

export interface KnowledgeUnit {
  id: string;
  vector: number[];
  text: string;
  type: KnowledgeType;
  layer: Layer;
  workspace_id: number | null;
  session_id: string | null;
  agent_type: AgentType;
  project_path: string | null;
  file_refs: string[];
  confidence: number;
  created: string;           // ISO timestamp
  source_timestamp: string;  // ISO timestamp
  stale_score: number;       // 0.0–1.0
  access_count: number;
  last_accessed: string | null;
  metadata: Record<string, unknown>;
}

/** A chunk produced by Tier 1 fast pass, before embedding. */
export interface RawChunk {
  text: string;
  type: KnowledgeType;
  layer: Layer;
  workspace_id: number | null;
  session_id: string | null;
  agent_type: AgentType;
  project_path: string | null;
  file_refs: string[];
  source_timestamp: string;
  metadata: Record<string, unknown>;
}

/** Provenance chain for federation-propagated knowledge. */
export interface ProvenanceChain {
  origin_node: string;
  origin_timestamp: string;
  hops: Array<{
    node: string;
    confidence: number;
    timestamp: string;
  }>;
  max_hops: number;
}

/** Search result with computed relevance score. */
export interface ScoredKnowledge extends KnowledgeUnit {
  relevance_score: number;  // similarity × confidence × (1 - stale_score) × recency_boost
  similarity: number;        // raw cosine similarity
}

/** Types that are high-value and should never be auto-pruned. */
export const PROTECTED_TYPES: KnowledgeType[] = ['decision', 'preference', 'error_fix'];

/** Types eligible for federation propagation. */
export const PROPAGATABLE_TYPES: KnowledgeType[] = ['decision', 'pattern', 'preference', 'error_fix'];

/** Minimum confidence for propagation. */
export const PROPAGATION_CONFIDENCE_THRESHOLD = 0.85;

/** Confidence multiplier per federation hop. */
export const HOP_DECAY_FACTOR = 0.8;

/** Max federation hops. */
export const MAX_HOPS = 3;
