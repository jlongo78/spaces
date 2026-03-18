/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export interface UsageRecord { input_tokens: number; output_tokens: number; calls: number; estimated_cost_usd: number; last_updated: string; }
export interface CortexUsage { distillation: UsageRecord; by_model: Record<string, UsageRecord>; }

const EMPTY: CortexUsage = {
  distillation: { input_tokens: 0, output_tokens: 0, calls: 0, estimated_cost_usd: 0, last_updated: '' },
  by_model: {},
};

export function readUsage(usagePath: string): CortexUsage {
  return getCortexAddon()?.readUsage?.(usagePath) ?? EMPTY;
}

export function recordUsage(usagePath: string, usage: any): void {
  getCortexAddon()?.recordUsage?.(usagePath, usage);
}
