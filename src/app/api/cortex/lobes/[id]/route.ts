import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getDb } from '@/lib/db/schema';
import { parseLobeConfig, serializeLobeConfig } from '@/lib/cortex/lobes/config';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const { id } = await params;
    const workspaceId = parseInt(id, 10);
    const db = getDb();
    const ws = db.prepare(
      'SELECT id, name, lobe_config FROM workspaces WHERE id = ?'
    ).get(workspaceId) as { id: number; name: string; lobe_config: string | null } | undefined;

    if (!ws) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    return NextResponse.json({
      workspaceId: ws.id,
      name: ws.name,
      config: parseLobeConfig(ws.lobe_config),
    });
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const { id } = await params;
    const workspaceId = parseInt(id, 10);
    const db = getDb();
    const ws = db.prepare(
      'SELECT id, lobe_config FROM workspaces WHERE id = ?'
    ).get(workspaceId) as { id: number; lobe_config: string | null } | undefined;

    if (!ws) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const existing = parseLobeConfig(ws.lobe_config);
    const partial = await request.json();

    const updated = {
      ...existing,
      ...partial,
      excludedFrom: partial.excludedFrom ?? existing.excludedFrom,
      subscriptions: partial.subscriptions ?? existing.subscriptions,
      tags: partial.tags ?? existing.tags,
    };

    db.prepare('UPDATE workspaces SET lobe_config = ? WHERE id = ?').run(
      serializeLobeConfig(updated),
      workspaceId,
    );

    return NextResponse.json({ workspaceId, config: updated });
  });
}
