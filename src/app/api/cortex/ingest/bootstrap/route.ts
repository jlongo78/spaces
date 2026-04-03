import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { runBootstrap } from '@/lib/cortex/ingestion/bootstrap';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const { spacesDir } = getUserPaths(user);
    const cortexDir = path.join(spacesDir, 'cortex');

    console.log(`[Cortex Ingest] Starting bootstrap for ${user} in ${cortexDir}`);

    // Run bootstrap asynchronously
    runBootstrap(cortex.pipeline, cortexDir).catch(err => {
      console.error('[Cortex Ingest] Bootstrap error:', err);
    });

    return NextResponse.json({ status: 'started' });
  });
}
