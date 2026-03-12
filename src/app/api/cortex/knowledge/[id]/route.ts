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

    for (const layer of ['personal', 'workspace', 'team']) {
      const results = await cortex.store.search(layer, [], 1, `id = '${id.replace(/'/g, "''")}'`);
      if (results.length > 0) {
        return NextResponse.json(results[0]);
      }
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { id } = await params;
    const updates = await request.json();

    for (const layer of ['personal', 'workspace', 'team']) {
      const safeId = id.replace(/'/g, "''");
      const results = await cortex.store.search(layer, [], 1, `id = '${safeId}'`);
      if (results.length > 0) {
        const existing = results[0];
        await cortex.store.delete(layer, id);
        const merged = {
          ...existing,
          ...updates,
          id,
        };
        const targetLayer = merged.layer === 'workspace' && merged.workspace_id
          ? `workspace/${merged.workspace_id}` : merged.layer;
        await cortex.store.add(targetLayer, merged);
        return NextResponse.json({ success: true });
      }
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { id } = await params;

    for (const layer of ['personal', 'workspace', 'team']) {
      await cortex.store.delete(layer, id);
    }

    return NextResponse.json({ success: true });
  });
}
