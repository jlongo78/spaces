/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export class ContextEngine {
  constructor(deps: any) {
    const addon = getCortexAddon();
    if (addon?.ContextEngine) return new addon.ContextEngine(deps) as any;
  }
  async assemble(...args: any[]): Promise<any> { return { results: [], tokenCount: 0 }; }
}
