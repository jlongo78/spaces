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
    const isRemote = !!body.nodeId;

    // workspace_sessions has a FK to sessions(id), so skip for remote sessions
    // (the remote session doesn't exist in the local sessions table)
    if (!isRemote) {
      addSessionToWorkspace(wsId, body.sessionId);
    }

    // Create a pane in the workspace so it's visible
    const session = isRemote ? null : getSessionById(body.sessionId);
    const title = session
      ? (session.customName || session.summary || session.firstPrompt?.slice(0, 50) || 'Claude')
      : (body.title || 'Remote Session');
    const cwd = session ? (session.projectPath || '/tmp') : (body.cwd || '/tmp');

    createPane({
      id: crypto.randomUUID(),
      title,
      color: '#8b5cf6',
      cwd,
      claudeSessionId: session?.sessionId || body.sessionId,
      agentType: 'claude',
      workspaceId: wsId,
      nodeId: body.nodeId || undefined,
    });

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
