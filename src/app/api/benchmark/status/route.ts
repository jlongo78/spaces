import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getBenchmarkProcess } from '@/lib/cortex/benchmark';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const bp = getBenchmarkProcess();
    if (!bp) {
      return NextResponse.json({ running: false });
    }

    const running = !bp.process.killed && bp.process.exitCode === null;
    const output = bp.getOutput();

    // Parse progress from output (look for [N/M] pattern)
    const progressMatches = [...output.matchAll(/\[(\d+)\/(\d+)\]/g)];
    const lastMatch = progressMatches[progressMatches.length - 1];
    const current = lastMatch ? parseInt(lastMatch[1]) : 0;
    const total = lastMatch ? parseInt(lastMatch[2]) : 0;

    return NextResponse.json({
      running,
      pid: bp.pid,
      startedAt: bp.startedAt,
      preset: bp.preset,
      categories: bp.categories,
      model: bp.model,
      progress: { current, total },
      output: output.slice(-2000), // Last 2000 chars
      exitCode: bp.process.exitCode,
    });
  });
}
