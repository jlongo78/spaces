// Guard: no code under src/ may hardcode the '.spaces' folder name; the data
// folder must come from spacesHome().
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['src', 'bin', 'scripts'];
const EXTS = new Set(['.ts', '.tsx', '.js']);
const ALLOW = new Set([
  'bin/lib/spaces-home.js',
  'src/lib/spaces-home.ts',
  'src/lib/file-policy.ts',
  'bin/lib/runtime/files.js',
  'bin/scrub-standalone.js',
  // Target-user installs deliberately ignore SPACES_HOME and keep <target home>/.spaces.
  'bin/spaces-install.js',
  'bin/spaces-service.js',
]);

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(e.name))) out.push(full);
  }
}

describe('spaces-home sweep', () => {
  it("has no hardcoded '.spaces' path segment outside the allowlist", () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (ALLOW.has(rel)) continue;
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/['"]\.spaces['"]/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders, `hardcoded '.spaces':\n${offenders.join('\n')}`).toEqual([]);
  });

  it('requires spaces-home before the first spacesHome( call', () => {
    const files: string[] = [];
    for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (rel === 'bin/lib/spaces-home.js' || rel === 'src/lib/spaces-home.ts') continue;
      const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
      const call = lines.findIndex((l) => /\bspacesHome\(/.test(l) && !/require\(|import /.test(l));
      if (call < 0) continue;
      const req = lines.findIndex((l) => /spaces-home['"]/.test(l));
      if (req < 0 || req > call) offenders.push(`${rel}:${call + 1}`);
    }
    expect(offenders, `spacesHome() used before its require:\n${offenders.join('\n')}`).toEqual([]);
  });
});
