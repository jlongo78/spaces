import { createRequire } from 'module';
import path from 'path';

let _teams: any = null;
let _checked = false;

export function getTeams() {
  if (!_checked) {
    try {
      const dynamicRequire = createRequire(path.join(process.cwd(), 'package.json'));
      _teams = dynamicRequire('@spaces/teams');
    } catch {}
    _checked = true;
  }
  return _teams;
}

export function hasTeams(): boolean {
  return getTeams() !== null;
}
