import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';
import { ensureInitialized } from '@/lib/db/init';
import { getSessions, getWorkspacesForSession } from '@/lib/db/queries';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest) {
  const pro = getPro();
  if (!pro) return notAvailable();

  try {
    pro.network.requireNetworkAuth(req);
  } catch (e: any) {
    if (e.name === 'NetworkAuthError') {
      return Response.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  await ensureInitialized();

  const { searchParams } = req.nextUrl;
  const params = {
    projectId: searchParams.get('projectId') || undefined,
    projectPath: searchParams.get('projectPath') || undefined,
    search: searchParams.get('search') || undefined,
    sortBy: searchParams.get('sortBy') || 'modified',
    sortDir: searchParams.get('sortDir') || 'DESC',
    offset: parseInt(searchParams.get('offset') || '0', 10),
    limit: parseInt(searchParams.get('limit') || '50', 10),
  };

  const result = getSessions(params);

  const sessions = result.sessions.map(s => ({
    ...s,
    workspaces: getWorkspacesForSession(s.id),
  }));

  return Response.json({ sessions, total: result.total });
}
