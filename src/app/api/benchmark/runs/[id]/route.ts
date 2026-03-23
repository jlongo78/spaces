import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getBenchmarkAccess } from '@/lib/cortex/benchmark';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  const { id } = await params;
  return withUser(user, async () => {
    const access = getBenchmarkAccess();
    if (!access) {
      return NextResponse.json({ error: 'Benchmark data not available' }, { status: 404 });
    }
    const run = access.getRun(id);
    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    const summary = access.getRunSummary(id);
    const categories = access.getCategoryBreakdown(id);
    const results = access.getTaskResults(id);
    return NextResponse.json({ run, summary, categories, results });
  });
}
