import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');
    const projectPath = url.searchParams.get('project_path');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    const layerKey = workspaceId ? `workspace/${workspaceId}` : 'personal';
    const dummyVector = new Array(cortex.embedding.dimensions).fill(0);
    let results = await cortex.store.search(layerKey, dummyVector, limit * 2);

    results = results.filter((r: any) =>
      ['decision', 'pattern', 'error_fix', 'summary'].includes(r.type)
    );

    if (projectPath) {
      results = results.filter((r: any) => r.project_path === projectPath);
    }

    results.sort((a: any, b: any) =>
      new Date(b.source_timestamp).getTime() - new Date(a.source_timestamp).getTime()
    );

    return NextResponse.json({
      timeline: results.slice(0, limit),
      count: results.length,
    });
  });
}
