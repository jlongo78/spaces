import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/db/init';
import { bulkAddTag, bulkAddToWorkspace, bulkStar } from '@/lib/db/queries';

export async function POST(request: NextRequest) {
  await ensureInitialized();
  const body = await request.json();
  const { sessionIds, action } = body;

  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return NextResponse.json({ error: 'No sessions selected' }, { status: 400 });
  }

  switch (action) {
    case 'tag':
      bulkAddTag(sessionIds, body.tagName);
      return NextResponse.json({ success: true, count: sessionIds.length });
    case 'workspace':
      bulkAddToWorkspace(sessionIds, body.workspaceId);
      return NextResponse.json({ success: true, count: sessionIds.length });
    case 'star':
      bulkStar(sessionIds, true);
      return NextResponse.json({ success: true, count: sessionIds.length });
    case 'unstar':
      bulkStar(sessionIds, false);
      return NextResponse.json({ success: true, count: sessionIds.length });
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
