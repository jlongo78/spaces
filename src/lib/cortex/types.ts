/**
 * Shared types that the base app needs at build time.
 * The actual implementations live in @spaces/cortex.
 */

// Minimal CortexInstance shape for type-checking in the base app
export interface CortexInstance {
  config: any;
  store: any;
  search: any;
  pipeline: any;
  embedding: any;
  graph: any;
  contextEngine?: any;
  signalPipeline?: any;
  gravityScheduler?: any;
  sync?: any;
  distillQueue?: any;
  distillScheduler?: any;
}

// LobeConfig — used by workspace-chooser.tsx and terminal/page.tsx
export interface LobeConfig {
  tags: string[];
  excludeTags: string[];
  excludedFrom: number[];
  subscriptions: string[];
  private: boolean;
  isPrivate?: boolean;
  domain_context?: string;
}

export const DEFAULT_LOBE_CONFIG: LobeConfig = {
  tags: [],
  excludeTags: [],
  excludedFrom: [],
  subscriptions: [],
  private: false,
};
