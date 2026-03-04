import { createRequire } from 'module';
import path from 'path';

let _pro: any = null;
let _checked = false;

export function getPro() {
  if (!_checked) {
    for (const root of requireRoots()) {
      try {
        _pro = createRequire(root)('@spaces/pro');
        break;
      } catch {}
    }
    _checked = true;
  }
  return _pro;
}

export function hasPro(): boolean {
  return getPro() !== null;
}

/** Build a list of require anchors: cwd first, then each NODE_PATH entry. */
function requireRoots(): string[] {
  const roots = [path.join(process.cwd(), 'package.json')];
  for (const dir of (process.env.NODE_PATH || '').split(path.delimiter)) {
    if (dir) roots.push(path.join(dir, '_anchor.js'));
  }
  return roots;
}
