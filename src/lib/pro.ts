import { createRequire } from 'module';
import path from 'path';

let _pro: any = null;
let _checked = false;

export function getPro() {
  if (!_checked) {
    try {
      // Use createRequire anchored to project root (process.cwd()) to
      // bypass turbopack's static analysis — turbopack replaces bare
      // require() with a build-time error for symlinked packages it
      // can't resolve. createRequire with a runtime path leaves the
      // resolution to Node at runtime.
      const dynamicRequire = createRequire(path.join(process.cwd(), 'package.json'));
      _pro = dynamicRequire('@spaces/pro');
    } catch {}
    _checked = true;
  }
  return _pro;
}

export function hasPro(): boolean {
  return getPro() !== null;
}
