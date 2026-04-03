/** Stub — type definitions for build-time compatibility */
export const KNOWLEDGE_TYPES = ['context', 'code_pattern', 'command', 'conversation', 'summary', 'decision', 'pattern', 'preference', 'error_fix'] as const;
export type KnowledgeType = typeof KNOWLEDGE_TYPES[number];

export const LAYERS = ['personal', 'workspace', 'team'] as const;
export type Layer = typeof LAYERS[number];

export type AgentType = 'claude' | 'codex' | 'gemini' | 'aider' | 'forge';

export function isValidKnowledgeType(t: string): t is KnowledgeType {
  return KNOWLEDGE_TYPES.includes(t as any);
}

export function isValidLayer(l: string): l is Layer {
  return LAYERS.includes(l as any);
}

export const CONFIDENCE_BASE: Record<KnowledgeType, number> = {
  context: 0.6, code_pattern: 0.7, command: 0.6, conversation: 0.4, summary: 0.6,
  decision: 0.8, pattern: 0.7, preference: 0.8, error_fix: 0.7,
};

export function getConfidenceBase(type: KnowledgeType): number {
  return CONFIDENCE_BASE[type] ?? 0.5;
}

export const HALFLIFE_DAYS: Record<KnowledgeType, number> = {
  context: 30, code_pattern: 60, command: 30, conversation: 14, summary: 60,
  decision: 180, pattern: 90, preference: 180, error_fix: 90,
};

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
  created: string;
  source_timestamp: string;
  stale_score: number;
  access_count: number;
  last_accessed: string | null;
  metadata: Record<string, unknown>;
  scope?: any;
  entity_links?: any[];
  evidence_score?: number;
  corroborations?: number;
  contradiction_refs?: string[];
  sensitivity?: string;
  creator_scope?: any;
  origin?: any;
  propagation_path?: any[];
}

export interface ScoredKnowledge extends KnowledgeUnit {
  relevance_score: number;
  similarity: number;
}

export const SCOPE_LEVELS = ['personal', 'team', 'department', 'organization'] as const;
export type ScopeLevel = typeof SCOPE_LEVELS[number];
