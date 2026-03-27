import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';
import { ensureInitialized } from '@/lib/db/init';
import { getPanesByWorkspace, getActivePanes, createPane } from '@/lib/db/queries';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest) {
  const pro = getPro();
  if (!pro) return notAvailable();

  let keyRecord;
  try { keyRecord = pro.network.requireNetworkAuth(req); }
  catch (e: any) {
    if (e.name === 'NetworkAuthError') return Response.json({ error: e.message }, { status: 401 });
    throw e;
  }

  await ensureInitialized();
  const wsId = req.nextUrl.searchParams.get('workspace_id');
  const panes = wsId ? getPanesByWorkspace(parseInt(wsId, 10)) : getActivePanes();
  return Response.json({ panes });
}

export async function POST(req: NextRequest) {
  const pro = getPro();
  if (!pro) return notAvailable();

  let keyRecord;
  try { keyRecord = pro.network.requireNetworkAuth(req); }
  catch (e: any) {
    if (e.name === 'NetworkAuthError') return Response.json({ error: e.message }, { status: 401 });
    throw e;
  }
  if (keyRecord?.permissions !== 'admin') return Response.json({ error: 'Admin permission required' }, { status: 403 });

  await ensureInitialized();
  const body = await req.json();
  const pane = createPane({
    title: body.title || 'Terminal',
    color: body.color || '#6366f1',
    cwd: body.cwd || '~',
    agentType: body.agentType || 'shell',
    workspaceId: body.workspaceId,
  });
  return Response.json(pane);
}
