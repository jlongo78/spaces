import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';
import { ensureInitialized } from '@/lib/db/init';
import { getDb } from '@/lib/db/schema';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest) {
  const pro = getPro();
  if (!pro) return notAvailable();

  let keyRecord;
  try {
    keyRecord = pro.network.requireNetworkAuth(req);
  } catch (e: any) {
    if (e.name === 'NetworkAuthError') {
      return Response.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  // Scope to the API key's user so remote access sees their workspaces, not the server admin's
  const keyUser = keyRecord?.username;
  if (keyUser) {
    const { withUser } = await import('@/lib/auth');
    return withUser(keyUser, async () => {
      await ensureInitialized();
      return buildWorkspaceResponse();
    });
  }

  await ensureInitialized();
  return buildWorkspaceResponse();
}

function buildWorkspaceResponse() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT w.id, w.name, w.description, w.color, w.created, w.is_active as isActive,
      w.collaboration,
      COUNT(p.id) as paneCount
    FROM workspaces w
    LEFT JOIN panes p ON p.workspace_id = w.id
    GROUP BY w.id
    ORDER BY w.created ASC
  `).all() as Record<string, unknown>[];

  const workspaces = rows.map(w => ({
    id: w.id as number,
    name: w.name as string,
    description: w.description as string,
    color: w.color as string,
    created: w.created as string,
    isActive: !!(w.isActive as number),
    collaboration: !!(w.collaboration as number),
    paneCount: w.paneCount as number,
  }));

  return Response.json({ workspaces, total: workspaces.length });
}
