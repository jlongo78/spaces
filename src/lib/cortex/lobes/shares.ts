/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from '../index';

export class LobeShareStore {
  constructor(...args: any[]) {
    const addon = getCortexAddon();
    if (addon?.LobeShareStore) return new addon.LobeShareStore(...args) as any;
  }
  listIncoming(...args: any[]): any[] { return []; }
  listOutgoing(...args: any[]): any[] { return []; }
  share(...args: any[]): any { return null; }
  accept(...args: any[]): void {}
  revoke(...args: any[]): void {}
}
