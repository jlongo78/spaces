/** Stub — delegates to @spaces/cortex addon */
import { getCortexAddon } from './index';

export function cortexDebug(...args: unknown[]): void {
  getCortexAddon()?.cortexDebug(...args);
}

export function setCortexDebug(enabled: boolean): void {
  getCortexAddon()?.setCortexDebug(enabled);
}
