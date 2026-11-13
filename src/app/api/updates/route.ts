import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { spacesHome } from '@/lib/spaces-home';


/** True when `candidate` is later than `current`, by number (see bin/lib/version.js). */
function isNewer(candidate: string, current: string): boolean {
  if (!candidate || !current) return false;
  const parts = (v: string) => {
    const [core, pre = ''] = v.replace(/^v/, '').split('-', 2);
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre };
  };
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.nums.length, b.nums.length, 3); i++) {
    const d = (a.nums[i] || 0) - (b.nums[i] || 0);
    if (d) return d > 0;
  }
  if (a.pre === b.pre) return false;
  if (!a.pre) return true;
  if (!b.pre) return false;
  return a.pre.localeCompare(b.pre, undefined, { numeric: true }) > 0;
}

export const dynamic = 'force-dynamic';

const UPDATE_CHECK_PATH = path.join(spacesHome(), 'update-check.json');
const CACHE_TTL = 4 * 3600_000; // 4 hours

async function freshCheck(): Promise<any> {
  try {
    const name = '@jlongo78/agent-spaces';

    // Determine current version: prefer the launcher's cache (written by spaces.js
    // which reads the real package.json), then try reading package.json directly,
    // then fall back to npm_package_version env var.
    let version = '0.0.0';
    try {
      const cached = JSON.parse(fs.readFileSync(UPDATE_CHECK_PATH, 'utf-8'));
      if (cached.current) version = cached.current;
    } catch { /* */ }
    if (version === '0.0.0') {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
        if (pkg.version) version = pkg.version;
      } catch { /* */ }
    }
    if (version === '0.0.0' && process.env.npm_package_version) {
      version = process.env.npm_package_version;
    }

    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const result = {
      current: version,
      latest: data.version,
      available: isNewer(data.version, version),
      checkedAt: Date.now(),
      name,
    };
    try { fs.writeFileSync(UPDATE_CHECK_PATH, JSON.stringify(result, null, 2)); } catch { /* */ }
    return result;
  } catch { return null; }
}

export async function GET() {
  // Return cached data if fresh enough
  try {
    if (fs.existsSync(UPDATE_CHECK_PATH)) {
      const cached = JSON.parse(fs.readFileSync(UPDATE_CHECK_PATH, 'utf-8'));
      if (Date.now() - (cached.checkedAt || 0) < CACHE_TTL) {
        return NextResponse.json(cached);
      }
    }
  } catch { /* stale or missing */ }

  // Cache is stale or missing — do a live check
  const result = await freshCheck();
  return NextResponse.json(result ?? { available: false });
}
