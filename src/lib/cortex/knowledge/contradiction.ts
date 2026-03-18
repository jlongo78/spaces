/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export function cosineSimilarity(a: number[], b: number[]): number {
  return getCortexAddon()?.cosineSimilarity?.(a, b) ?? 0;
}

export function detectContradictions(...args: any[]): any[] {
  return getCortexAddon()?.detectContradictions?.(...args) ?? [];
}
