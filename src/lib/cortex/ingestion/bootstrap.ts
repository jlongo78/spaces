/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export interface BootstrapProgress { status: string; processedFiles: number; totalFiles: number; errors: string[]; }

const IDLE: BootstrapProgress = { status: 'idle', processedFiles: 0, totalFiles: 0, errors: [] };

export async function runBootstrap(...args: any[]): Promise<BootstrapProgress> {
  return getCortexAddon()?.runBootstrap?.(...args) ?? IDLE;
}

export function getBootstrapProgress(): BootstrapProgress {
  return getCortexAddon()?.getBootstrapProgress?.() ?? IDLE;
}
