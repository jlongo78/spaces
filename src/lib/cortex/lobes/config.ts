/** Stub — lobe config types and parsing */
import { getCortexAddon } from '../index';
import { DEFAULT_LOBE_CONFIG } from '../types';
export type { LobeConfig } from '../types';
export { DEFAULT_LOBE_CONFIG } from '../types';

export function parseLobeConfig(raw: string | null): import('../types').LobeConfig {
  const addon = getCortexAddon();
  if (addon?.parseLobeConfig) return addon.parseLobeConfig(raw);
  if (raw) { try { return { ...DEFAULT_LOBE_CONFIG, ...JSON.parse(raw) }; } catch {} }
  return { ...DEFAULT_LOBE_CONFIG };
}

export function serializeLobeConfig(config: import('../types').LobeConfig): string {
  return getCortexAddon()?.serializeLobeConfig?.(config) ?? JSON.stringify(config);
}
