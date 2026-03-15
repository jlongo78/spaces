import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';

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
    if (!cortex?.graph) {
      return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });
    }

    const { id } = await params;
    const entity = cortex.graph.getEntity(id);
    if (!entity) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ entity });
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) {
      return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, metadata } = body as { name?: string; metadata?: Record<string, unknown> };

    const entity = cortex.graph.updateEntity(id, { name, metadata });
    if (!entity) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ entity });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) {
      return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });
    }

    const { id } = await params;
    cortex.graph.deleteEntity(id);
    return NextResponse.json({ deleted: true });
  });
}
