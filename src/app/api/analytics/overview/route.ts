import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getAnalyticsOverview, getSessions, getDailyActivity } from '@/lib/db/queries';
import { getOrComputeStats } from '@/lib/claude/stats';
import { calculateCost } from '@/lib/cost-calculator';
import type { DailyActivity, DailyModelTokens } from '@/types/claude';

/** Fill date gaps so charts show every day through today */
function fillDailyGaps<T extends { date: string }>(
  data: T[],
  days: number,
  defaults: Omit<T, 'date'>,
): T[] {
  const map = new Map(data.map(d => [d.date, d]));
  const result: T[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push(map.get(key) || { date: key, ...defaults } as T);
  }
  return result;
}

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();

    const overview = getAnalyticsOverview();
    const { sessions: recentSessions } = getSessions({ limit: 5, sortBy: 'modified', sortDir: 'DESC' });
    const dbActivity = getDailyActivity(30);

    // Compute fresh stats from JSONL session files (cached for 1h)
    const stats = getOrComputeStats(user);
    const estimatedCost = stats?.modelUsage ? calculateCost(stats.modelUsage) : 0;

    // Merge JSONL-computed stats with DB activity
    const statsActivity: DailyActivity[] = stats?.dailyActivity || [];
    const statsMap = new Map(statsActivity.map((d: DailyActivity) => [d.date, d]));
    const mergedActivity = dbActivity.map(d => {
      const cached = statsMap.get(d.date);
      return {
        ...d,
        toolCallCount: cached?.toolCallCount ?? d.toolCallCount,
        messageCount: cached?.messageCount ?? d.messageCount,
      };
    });
    // Add stats-only dates not in DB
    for (const s of statsActivity) {
      if (!mergedActivity.find(d => d.date === s.date)) {
        mergedActivity.push(s);
      }
    }
    mergedActivity.sort((a, b) => a.date.localeCompare(b.date));

    // Fill gaps through today
    const dailyActivity = fillDailyGaps(mergedActivity, 30, {
      sessionCount: 0, messageCount: 0, toolCallCount: 0,
    } as any);

    const rawTokens: DailyModelTokens[] = stats?.dailyModelTokens || [];
    const dailyModelTokens = fillDailyGaps(rawTokens, 30, {
      tokensByModel: {},
    } as any);

    return NextResponse.json({
      ...overview,
      estimatedCost,
      recentSessions,
      dailyActivity,
      dailyModelTokens,
      modelUsage: stats?.modelUsage || {},
    });
  });
}
