import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json(
        { error: 'Cortex is not available on the Community tier' },
        { status: 403 },
      );
    }

    const cortex = await getCortex();
    if (!cortex) {
      return NextResponse.json({ enabled: false, status: 'disabled' });
    }

    const stats = await cortex.store.stats();
    return NextResponse.json({
      enabled: true,
      status: 'healthy',
      embedding_provider: cortex.embedding.name,
      embedding_dimensions: cortex.embedding.dimensions,
      layers: stats,
    });
  });
}
