import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getAnalyticsOverview, getSessions } from '@/lib/db/queries';
import { readStatsCache } from '@/lib/claude/parser';
import { calculateCost } from '@/lib/cost-calculator';
import { getUserPaths } from '@/lib/config';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();

    const overview = getAnalyticsOverview();
    const { sessions: recentSessions } = getSessions({ limit: 5, sortBy: 'modified', sortDir: 'DESC' });

    // Read stats cache for activity data
    const { statsPath } = getUserPaths(user);
    const stats = readStatsCache(statsPath);
    const estimatedCost = stats?.modelUsage ? calculateCost(stats.modelUsage) : 0;

    return NextResponse.json({
      ...overview,
      estimatedCost,
      recentSessions,
      dailyActivity: stats?.dailyActivity || [],
      dailyModelTokens: stats?.dailyModelTokens || [],
      modelUsage: stats?.modelUsage || {},
    });
  });
}
