import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getDb } from '@/lib/db/schema';
import { parseLobeConfig } from '@/lib/cortex/lobes/config';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const db = getDb();
    const workspaces = db.prepare(
      'SELECT id, name, color, lobe_config FROM workspaces ORDER BY name'
    ).all() as any[];
    const lobes = workspaces.map(ws => ({
      workspaceId: ws.id,
      name: ws.name,
      color: ws.color,
      config: parseLobeConfig(ws.lobe_config),
    }));
    return NextResponse.json({ lobes });
  });
}
