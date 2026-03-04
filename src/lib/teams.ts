import { createRequire } from 'module';
import path from 'path';

let _teams: any = null;
let _checked = false;

export function getTeams() {
  if (!_checked) {
    for (const root of requireRoots()) {
      try {
        _teams = createRequire(root)('@spaces/teams');
        break;
      } catch {}
    }
    _checked = true;
  }
  return _teams;
}

export function hasTeams(): boolean {
  return getTeams() !== null;
}

/** Build a list of require anchors: cwd first, then each NODE_PATH entry. */
function requireRoots(): string[] {
  const roots = [path.join(process.cwd(), 'package.json')];
  for (const dir of (process.env.NODE_PATH || '').split(path.delimiter)) {
    if (dir) roots.push(path.join(dir, '_anchor.js'));
  }
  return roots;
}
