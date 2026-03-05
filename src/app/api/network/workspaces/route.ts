import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';
import { ensureInitialized } from '@/lib/db/init';
import { getAllWorkspaces } from '@/lib/db/queries';

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
  const workspaces = getAllWorkspaces();
  return Response.json({ workspaces, total: workspaces.length });
}
