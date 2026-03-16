import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';
import { isValidEntityType } from '@/lib/cortex/graph/types';
import type { EntityType } from '@/lib/cortex/graph/types';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) return NextResponse.json({ entities: [] });

    const url = new URL(request.url);
    const typeParam = url.searchParams.get('type') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;

    if (typeParam !== undefined && !isValidEntityType(typeParam)) {
      return NextResponse.json({ error: `Invalid entity type: ${typeParam}` }, { status: 400 });
    }

    const type = typeParam as EntityType | undefined;
    const entities = cortex.graph.listEntities({ type, limit });
    return NextResponse.json({ entities });
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
    const { type, name, id, metadata } = body as {
      type?: string;
      name?: string;
      id?: string;
      metadata?: Record<string, unknown>;
    };

    if (!type || !name) {
      return NextResponse.json({ error: 'type and name are required' }, { status: 400 });
    }

    if (!isValidEntityType(type)) {
      return NextResponse.json({ error: `Invalid entity type: ${type}` }, { status: 400 });
    }

    // Check for conflict if id is provided
    if (id && cortex.graph.getEntity(id)) {
      return NextResponse.json({ error: `Entity with id '${id}' already exists` }, { status: 409 });
    }

    try {
      const entity = cortex.graph.createEntity({ type, name, id, metadata });
      return NextResponse.json({ entity }, { status: 201 });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE constraint failed')) {
        return NextResponse.json({ error: 'Entity already exists' }, { status: 409 });
      }
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}
