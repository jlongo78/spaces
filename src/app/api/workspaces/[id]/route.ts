import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { deleteWorkspaceFull, updateWorkspace, getPanesByWorkspace, getWorkspaceSessions } from '@/lib/db/queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const wsId = parseInt(id, 10);
    const panes = getPanesByWorkspace(wsId);
    // Also return legacy session data for backwards compat
    const sessions = getWorkspaceSessions(wsId);
    return NextResponse.json({ panes, sessions });
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const body = await request.json();
    updateWorkspace(parseInt(id, 10), body);
    return NextResponse.json({ success: true });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    deleteWorkspaceFull(parseInt(id, 10));
    return NextResponse.json({ success: true });
  });
}
