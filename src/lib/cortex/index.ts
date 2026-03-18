/**
 * Cortex addon loader — delegates to @spaces/cortex when installed.
 * This is a thin facade; the actual engine lives in the private spaces-cortex repo.
 */
import { createRequire } from 'module';
import path from 'path';

let _cortex: any = null;
let _checked = false;

function loadAddon(): any {
  if (!_checked) {
    const roots = [path.join(process.cwd(), 'package.json')];
    for (const dir of (process.env.NODE_PATH || '').split(path.delimiter)) {
      if (dir) roots.push(path.join(dir, '_anchor.js'));
    }
    for (const root of roots) {
      try {
        _cortex = createRequire(root)('@spaces/cortex');
        break;
      } catch {}
    }
    _checked = true;
  }
  return _cortex;
}

export function getCortexAddon(): any { return loadAddon(); }
export function hasCortexAddon(): boolean { return loadAddon() !== null; }

// Re-export engine functions — delegate to addon or return safe fallbacks
export async function getCortex() { return loadAddon()?.getCortex() ?? null; }
export function isCortexAvailable(): boolean { return loadAddon()?.isCortexAvailable() ?? false; }
export function resetCortex(): void { loadAddon()?.resetCortex(); }
export type { CortexInstance } from './types';
