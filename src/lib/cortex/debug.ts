/** Cortex debug logger — only emits when cortex.debug is true in config. */
let _debug = false;

export function setCortexDebug(enabled: boolean): void {
  _debug = enabled;
}

export function cortexDebug(...args: unknown[]): void {
  if (_debug) console.log('[Cortex Debug]', ...args);
}
