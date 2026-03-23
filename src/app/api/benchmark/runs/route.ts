import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getBenchmarkAccess } from '@/lib/cortex/benchmark';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const access = getBenchmarkAccess();
    if (!access) {
      return NextResponse.json({ error: 'Benchmark data not available' }, { status: 404 });
    }
    const runs = access.listRuns();
    return NextResponse.json({ runs });
  });
}
