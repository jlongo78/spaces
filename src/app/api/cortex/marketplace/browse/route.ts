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
    const { spacesDir } = getUserPaths(user);
    const marketDir = path.join(spacesDir, 'cortex', 'marketplace');

    if (!fs.existsSync(marketDir)) {
      fs.mkdirSync(marketDir, { recursive: true });
      return NextResponse.json({ packs: [], directory: marketDir });
    }

    const files = fs.readdirSync(marketDir).filter(f => f.endsWith('.cortexpack'));
    const packs: any[] = [];

    for (const filename of files) {
      try {
        const filePath = path.join(marketDir, filename);
        const stdout = execSync(
          `tar -xzf "${filePath}" -O manifest.json 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const manifest = JSON.parse(stdout);
        packs.push({ filename, manifest });
      } catch {
        const stat = fs.statSync(path.join(marketDir, filename));
        packs.push({
          filename,
          manifest: { version: 'unknown', exportDate: stat.mtime.toISOString(), unitCount: 0 },
        });
      }
    }

    return NextResponse.json({ packs, directory: marketDir });
  });
}
