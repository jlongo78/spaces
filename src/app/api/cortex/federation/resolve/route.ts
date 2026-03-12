import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex } from '@/lib/cortex';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { id, action } = await request.json();

    if (!id || !action) {
      return NextResponse.json({ error: 'id and action required' }, { status: 400 });
    }

    if (action === 'accept') {
      const safeId = id.replace(/'/g, "''");
      const results = await cortex.store.search('team', [], 1, `id = '${safeId}'`);
      if (results.length > 0) {
        const unit = results[0];
        await cortex.store.delete('team', id);
        unit.metadata = { ...unit.metadata, status: 'accepted' };
        unit.confidence = Math.min(unit.confidence * 1.1, 0.95);
        await cortex.store.add('team', unit);
      }
    } else if (action === 'reject') {
      await cortex.store.delete('team', id);
    } else if (action === 'context-dependent') {
      const safeId = id.replace(/'/g, "''");
      const results = await cortex.store.search('team', [], 1, `id = '${safeId}'`);
      if (results.length > 0) {
        const unit = results[0];
        await cortex.store.delete('team', id);
        unit.metadata = { ...unit.metadata, status: 'context_dependent' };
        await cortex.store.add('team', unit);
      }
    }

    return NextResponse.json({ success: true, action });
  });
}
