import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const url = new URL(request.url);
    const filename = url.searchParams.get('file');
    if (!filename) {
      return NextResponse.json({ error: 'file parameter required' }, { status: 400 });
    }

    const safe = path.basename(filename);
    if (!safe.endsWith('.cortexpack')) {
      return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    }

    const { spacesDir } = getUserPaths(user);
    const filePath = path.join(spacesDir, 'cortex', 'marketplace', safe);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
    }

    try {
      const stdout = execSync(
        `tar -xzf "${filePath}" -O knowledge.jsonl 2>/dev/null | head -5`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      const samples = stdout.trim().split('\n')
        .filter(Boolean)
        .map(line => {
          try { const u = JSON.parse(line); return { text: u.text?.slice(0, 200), type: u.type }; }
          catch { return null; }
        })
        .filter(Boolean);
      return NextResponse.json({ samples });
    } catch {
      return NextResponse.json({ samples: [] });
    }
  });
}
