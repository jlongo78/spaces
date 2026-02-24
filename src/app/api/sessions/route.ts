import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getSessions, getWorkspacesForSession } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();

    const { searchParams } = request.nextUrl;

    const params = {
      projectId: searchParams.get('projectId') || undefined,
      projectPath: searchParams.get('projectPath') || undefined,
      starred: searchParams.has('starred') ? searchParams.get('starred') === 'true' : undefined,
      tagId: searchParams.has('tagId') ? parseInt(searchParams.get('tagId')!, 10) : undefined,
      search: searchParams.get('search') || undefined,
      agentType: searchParams.get('agentType') || undefined,
      sortBy: searchParams.get('sortBy') || 'modified',
      sortDir: searchParams.get('sortDir') || 'DESC',
      offset: parseInt(searchParams.get('offset') || '0', 10),
      limit: parseInt(searchParams.get('limit') || '50', 10),
    };

    const localResult = getSessions(params);

    // If nodes=all, aggregate from remote nodes too
    // Note: Next.js trailing slash can append "/" to the value, so strip it
    const nodesParam = (searchParams.get('nodes') || '').replace(/\/+$/, '');
    if (nodesParam === 'all') {
      try {
        const pro = require('@spaces/pro');
        const { aggregateSessions } = pro.network;
        const remoteParams: Record<string, string> = {};
        if (params.search) remoteParams.search = params.search;
        if (params.sortBy) remoteParams.sortBy = params.sortBy;
        if (params.sortDir) remoteParams.sortDir = params.sortDir;
        remoteParams.limit = String(params.limit);

        const aggregated = await aggregateSessions(localResult, remoteParams);

        // Populate local workspace associations for remote sessions
        for (const session of aggregated.sessions) {
          if (session.nodeId) {
            session.workspaces = getWorkspacesForSession(session.id);
            if (!session.tags) session.tags = [];
          }
        }

        return NextResponse.json({
          sessions: aggregated.sessions,
          total: aggregated.total,
          errors: aggregated.errors,
        });
      } catch {
        // Aggregation failed, return local only
      }
    }

    return NextResponse.json(localResult);
  });
}
