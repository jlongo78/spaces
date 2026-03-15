import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';
import { isValidEdgeRelation } from '@/lib/cortex/graph/types';
import type { EdgeRelation } from '@/lib/cortex/graph/types';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) return NextResponse.json({ edges: [] });

    const url = new URL(request.url);
    const from = url.searchParams.get('from') ?? undefined;
    const to = url.searchParams.get('to') ?? undefined;
    const relationParam = url.searchParams.get('relation') ?? undefined;

    if (!from && !to) {
      return NextResponse.json({ error: 'from or to query param is required' }, { status: 400 });
    }

    if (relationParam !== undefined && !isValidEdgeRelation(relationParam)) {
      return NextResponse.json({ error: `Invalid relation: ${relationParam}` }, { status: 400 });
    }

    const relation = relationParam as EdgeRelation | undefined;

    const edges = from
      ? cortex.graph.getEdgesFrom(from, relation)
      : cortex.graph.getEdgesTo(to!, relation);

    return NextResponse.json({ edges });
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) {
      return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });
    }

    const body = await request.json();
    const { source_id, target_id, relation, weight, metadata } = body as {
      source_id?: string;
      target_id?: string;
      relation?: string;
      weight?: number;
      metadata?: Record<string, unknown>;
    };

    if (!source_id || !target_id || !relation) {
      return NextResponse.json(
        { error: 'source_id, target_id, and relation are required' },
        { status: 400 },
      );
    }

    if (!isValidEdgeRelation(relation)) {
      return NextResponse.json({ error: `Invalid relation: ${relation}` }, { status: 400 });
    }

    const edge = cortex.graph.createEdge({ source_id, target_id, relation, weight, metadata });
    return NextResponse.json({ edge }, { status: 201 });
  });
}

export async function DELETE(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) {
      return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });
    }

    const url = new URL(request.url);
    const source_id = url.searchParams.get('source_id');
    const target_id = url.searchParams.get('target_id');
    const relation = url.searchParams.get('relation');

    if (!source_id || !target_id || !relation) {
      return NextResponse.json(
        { error: 'source_id, target_id, and relation query params are required' },
        { status: 400 },
      );
    }

    if (!isValidEdgeRelation(relation)) {
      return NextResponse.json({ error: `Invalid relation: ${relation}` }, { status: 400 });
    }

    cortex.graph.deleteEdge(source_id, target_id, relation as EdgeRelation);
    return NextResponse.json({ deleted: true });
  });
}
