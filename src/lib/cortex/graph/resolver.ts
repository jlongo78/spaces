/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export class EntityResolver {
  constructor(graph: any) {
    const addon = getCortexAddon();
    if (addon?.EntityResolver) return new addon.EntityResolver(graph) as any;
  }
  resolve(...args: any[]): any { return null; }
}
