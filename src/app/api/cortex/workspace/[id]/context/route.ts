import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { id } = await params;
    const workspaceId = parseInt(id, 10);
    const url = new URL(request.url);
    const depth = url.searchParams.get('depth') || 'brief';
    const limit = depth === 'brief' ? 10 : 50;

    const dummyVector = new Array(cortex.embedding.dimensions).fill(0);
    const results = await cortex.store.search(
      `workspace/${workspaceId}`,
      dummyVector,
      limit,
    );

    results.sort((a, b) => b.confidence - a.confidence);

    return NextResponse.json({
      workspace_id: workspaceId,
      depth,
      units: results,
      count: results.length,
    });
  });
}
