import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';
import { ensureInitialized } from '@/lib/db/init';
import { searchSessions } from '@/lib/db/queries';

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
  const query = searchParams.get('q') || '';
  if (!query) {
    return Response.json({ results: [], query: '' });
  }

  const params = {
    projectId: searchParams.get('projectId') || undefined,
    limit: parseInt(searchParams.get('limit') || '20', 10),
    offset: parseInt(searchParams.get('offset') || '0', 10),
  };

  const results = searchSessions(query, params);
  return Response.json({ results, query });
}
