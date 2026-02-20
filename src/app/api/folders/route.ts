import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  const dir = request.nextUrl.searchParams.get('path') || `/home/${user}`;

  try {
    const resolved = path.resolve(dir);
    const entries = fs.readdirSync(resolved, { withFileTypes: true });

    const folders = entries
      .filter(e => {
        if (!e.isDirectory()) return false;
        // Skip hidden/system folders
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') return false;
        return true;
      })
      .map(e => ({
        name: e.name,
        path: path.join(resolved, e.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = path.dirname(resolved);

    return NextResponse.json({
      current: resolved,
      parent: parent !== resolved ? parent : null,
      folders,
    });
  } catch {
    return NextResponse.json({ current: dir, parent: null, folders: [], error: 'Cannot read directory' });
  }
}
