import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex } from '@/lib/cortex';
import { IS_FEDERATION } from '@/lib/tier';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    // Federation tier gate
    if (!IS_FEDERATION) {
      return NextResponse.json({ error: 'Federation not available' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ results: [] });

    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '5', 10);

    if (!query) return NextResponse.json({ results: [] });

    const [queryVector] = await cortex.embedding.embed([query]);

    // Only search team and collaborative workspace layers — never personal
    const results = await cortex.search.search(queryVector, {
      workspaceId: null,
      limit,
      excludeLayers: ['personal'],
    });

    return NextResponse.json({ results });
  });
}
