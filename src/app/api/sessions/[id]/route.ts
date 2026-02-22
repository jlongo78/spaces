import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import {
  getSessionById,
  toggleStar,
  updateSessionNotes,
  addTagToSession,
  removeTagFromSessionByName,
  renameSession,
  getSessionTags,
  getSessionWorkspaces,
} from '@/lib/db/queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const session = getSessionById(id);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const tags = getSessionTags(session.id);
    const workspaces = getSessionWorkspaces(session.id);

    return NextResponse.json({ ...session, tagObjects: tags, workspaces });
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

    if (body.action === 'star') {
      const starred = toggleStar(id);
      return NextResponse.json({ starred });
    }

    if (body.action === 'notes') {
      updateSessionNotes(id, body.notes || '');
      return NextResponse.json({ success: true });
    }

    if (body.action === 'tag') {
      addTagToSession(id, body.tagName);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'removeTag') {
      removeTagFromSessionByName(id, body.tagName);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'rename') {
      renameSession(id, body.name);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  });
}
