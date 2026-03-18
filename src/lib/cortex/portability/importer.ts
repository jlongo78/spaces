/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export async function importCortexpack(...args: any[]): Promise<any> {
  return getCortexAddon()?.importCortexpack?.(...args) ?? null;
}

export function getImportProgress(): any {
  return getCortexAddon()?.getImportProgress?.() ?? { status: 'idle' };
}
