import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

const UPDATE_CHECK_PATH = path.join(os.homedir(), '.spaces', 'update-check.json');
const CACHE_TTL = 4 * 3600_000; // 4 hours

async function freshCheck(): Promise<any> {
  try {
    let version = process.env.npm_package_version || '0.0.0';
    const name = '@jlongo78/agent-spaces';
    // The launcher writes current version to the cache — use it if available
    try {
      const cached = JSON.parse(fs.readFileSync(UPDATE_CHECK_PATH, 'utf-8'));
      if (cached.current) version = cached.current;
    } catch { /* */ }

    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const result = {
      current: version,
      latest: data.version,
      available: data.version !== version && data.version > version,
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
