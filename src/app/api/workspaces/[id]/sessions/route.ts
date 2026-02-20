import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { addSessionToWorkspace, removeSessionFromWorkspace, getSessionById, createPane } from '@/lib/db/queries';
import crypto from 'crypto';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const wsId = parseInt(id, 10);
    const body = await request.json();
    addSessionToWorkspace(wsId, body.sessionId);

    // Also create a Claude pane in the workspace so it's visible
    const session = getSessionById(body.sessionId);
    if (session) {
      const title = session.customName || session.summary || session.firstPrompt?.slice(0, 50) || 'Claude';
      createPane({
        id: crypto.randomUUID(),
        title,
        color: '#8b5cf6',
        cwd: session.projectPath || '/tmp',
        claudeSessionId: session.sessionId,
        agentType: 'claude',
        workspaceId: wsId,
      });
    }

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
    const body = await request.json();
    removeSessionFromWorkspace(parseInt(id, 10), body.sessionId);
    return NextResponse.json({ success: true });
  });
}
