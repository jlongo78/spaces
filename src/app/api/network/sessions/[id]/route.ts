import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';
import { ensureInitialized } from '@/lib/db/init';
import { getSessionById, getSessionTags, getSessionWorkspaces } from '@/lib/db/queries';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;
  const session = getSessionById(id);

  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const tags = getSessionTags(session.id);
  const workspaces = getSessionWorkspaces(session.id);

  return Response.json({ ...session, tagObjects: tags, workspaces });
}
