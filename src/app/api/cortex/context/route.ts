import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';
import { ContextEngine } from '@/lib/cortex/retrieval/context-engine';
import { EntityResolver } from '@/lib/cortex/graph/resolver';
import { slugify } from '@/lib/cortex/graph/types';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ results: [], context: '' });

    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '5', 10);
    const workspaceId = url.searchParams.get('workspace_id');
    const maxTokens = parseInt(url.searchParams.get('max_tokens') || '1500', 10);

    if (!query || query.length < 3) {
      return NextResponse.json({ results: [], context: '' });
    }

    const resolver = new EntityResolver(cortex.graph);
    const requesterId = `person-${slugify(user)}`;

    const engine = new ContextEngine({
      store: cortex.store,
      graph: cortex.graph,
      resolver,
      embedding: cortex.embedding,
      requesterId,
    });

    const result = await engine.assemble(query, {
      limit,
      workspaceId: workspaceId ? parseInt(workspaceId, 10) : null,
      maxTokens,
    });

    return NextResponse.json({
      results: result.results.map(r => ({ ...r, vector: undefined })),
      context: result.context,
      intent: result.intent,
      conflicts: result.conflicts,
      entities: result.entities,
      sourceWeights: result.sourceWeights,
      timing: result.timing,
    });
  });
}
