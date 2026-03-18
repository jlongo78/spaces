/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export const CORTEX_TOOLS: any[] = [];

export async function handleToolCall(...args: any[]): Promise<any> {
  return getCortexAddon()?.handleToolCall?.(...args) ?? { error: 'Cortex addon not installed' };
}
