/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export async function exportCortexpack(...args: any[]): Promise<any> {
  return getCortexAddon()?.exportCortexpack?.(...args) ?? null;
}
