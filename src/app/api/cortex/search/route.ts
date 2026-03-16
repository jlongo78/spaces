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
    if (!cortex) return NextResponse.json({ results: [] });

    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const workspaceId = url.searchParams.get('workspace_id');
    const layer = url.searchParams.get('layer') as 'personal' | 'workspace' | 'team' | null;
    const limit = parseInt(url.searchParams.get('limit') || '5', 10);

    // Browse mode: return recent knowledge without a search query
    if (!query) {
      const layers = layer ? [layer] : (['personal', 'workspace', 'team'] as const);
      const results: any[] = [];
      for (const l of layers) {
        const items = await cortex.store.browse(l, limit);
        results.push(...items);
      }
      return NextResponse.json({ results: results.slice(0, limit) });
    }

    const [queryVector] = await cortex.embedding.embed([query]);

    const results = await cortex.search.search(queryVector, {
      workspaceId: workspaceId ? parseInt(workspaceId, 10) : null,
      layers: layer ? [layer] : undefined,
      limit,
    });

    return NextResponse.json({ results });
  });
}
