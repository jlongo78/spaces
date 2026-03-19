import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { handleToolCall } from '@/lib/cortex/mcp/server';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const url = new URL(request.url);
    const workspace_id = parseInt(url.searchParams.get('workspace_id') || '0', 10);
    if (!workspace_id) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }
    const result = await handleToolCall('cortex_assess', { workspace_id }, cortex);
    if (result.isError) {
      return NextResponse.json({ error: JSON.parse(result.content[0].text) }, { status: 400 });
    }
    return NextResponse.json(JSON.parse(result.content[0].text));
  });
}
