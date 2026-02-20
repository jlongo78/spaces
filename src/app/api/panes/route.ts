import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/db/init';
import { getActivePanes, createPane } from '@/lib/db/queries';

export async function GET() {
  await ensureInitialized();
  return NextResponse.json(getActivePanes());
}

export async function POST(request: NextRequest) {
  await ensureInitialized();
  const body = await request.json();
  const pane = createPane({
    id: body.id || crypto.randomUUID(),
    title: body.title || 'Terminal',
    color: body.color || '#6366f1',
    cwd: body.cwd || process.env.HOME || process.env.USERPROFILE || 'C:\\',
    claudeSessionId: body.claudeSessionId,
    agentType: body.agentType || 'shell',
    customCommand: body.customCommand,
    sortOrder: body.sortOrder,
    workspaceId: body.workspaceId,
  });
  return NextResponse.json(pane);
}
