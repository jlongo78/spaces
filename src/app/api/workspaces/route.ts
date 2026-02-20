import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getDb } from '@/lib/db/schema';
import { createWorkspace, getActiveWorkspace, switchWorkspace, duplicateWorkspace } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const db = getDb();
    const rows = db.prepare(`
      SELECT w.id, w.name, w.description, w.color, w.created, w.is_active as isActive,
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
      paneCount: w.paneCount as number,
    }));

    return NextResponse.json(workspaces);
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const body = await request.json();

    if (body.action === 'switch') {
      switchWorkspace(body.workspaceId);
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'duplicate') {
      const result = duplicateWorkspace(body.sourceId, body.name, body.color);
      return NextResponse.json(result);
    }

    if (body.action === 'active') {
      const ws = getActiveWorkspace();
      return NextResponse.json(ws);
    }

    // Default: create new workspace
    const workspace = createWorkspace(body.name, body.description, body.color);
    return NextResponse.json(workspace);
  });
}
