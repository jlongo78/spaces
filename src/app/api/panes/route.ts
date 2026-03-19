import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getActivePanes, getPanesByWorkspace, createPane } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');
    if (workspaceId) {
      return NextResponse.json(getPanesByWorkspace(parseInt(workspaceId, 10)));
    }
    return NextResponse.json(getActivePanes());
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const body = await request.json();
    const pane = createPane({
      id: body.id || crypto.randomUUID(),
      title: body.title || 'Terminal',
      color: body.color || '#6366f1',
      cwd: body.cwd || require('os').homedir(),
      claudeSessionId: body.claudeSessionId,
      agentType: body.agentType || 'shell',
      customCommand: body.customCommand,
      sortOrder: body.sortOrder,
      workspaceId: body.workspaceId,
      nodeId: body.nodeId,
      isCollaborating: body.isCollaborating,
    });
    return NextResponse.json(pane);
  });
}
