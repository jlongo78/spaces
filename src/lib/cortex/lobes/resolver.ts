/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export interface ResolvedLobe { layer: string; label: string; weight: number; tags: string[]; }

export function resolveLobes(...args: any[]): ResolvedLobe[] {
  return getCortexAddon()?.resolveLobes?.(...args) ?? [];
}
