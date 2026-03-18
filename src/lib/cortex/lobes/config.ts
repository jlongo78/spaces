/** Stub — lobe config types and parsing */
import { getCortexAddon } from '../index';
export type { LobeConfig } from '../types';
export { DEFAULT_LOBE_CONFIG } from '../types';

export function parseLobeConfig(raw: string | null): import('../types').LobeConfig {
  return getCortexAddon()?.parseLobeConfig?.(raw) ?? { tags: [], excludeTags: [], private: false };
}

export function serializeLobeConfig(config: import('../types').LobeConfig): string {
  return getCortexAddon()?.serializeLobeConfig?.(config) ?? JSON.stringify(config);
}
