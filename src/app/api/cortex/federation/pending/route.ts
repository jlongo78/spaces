import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ units: [] });

    const dummyVector = new Array(cortex.embedding.dimensions).fill(0);
    const allTeam = await cortex.store.search('team', dummyVector, 100);
    const pending = allTeam.filter(
      (u: any) => u.metadata?.status === 'pending_review'
    );

    return NextResponse.json({ units: pending, count: pending.length });
  });
}
