import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';
import { ensureInitialized } from '@/lib/db/init';
import { getPaneById, updatePane, deletePane } from '@/lib/db/queries';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const pro = getPro();
  if (!pro) return notAvailable();

  let keyRecord;
  try { keyRecord = pro.network.requireNetworkAuth(req); }
  catch (e: any) {
    if (e.name === 'NetworkAuthError') return Response.json({ error: e.message }, { status: 401 });
    throw e;
  }

  const { id } = await params;
  await ensureInitialized();
  const pane = getPaneById(id);
  if (!pane) return Response.json({ error: 'Pane not found' }, { status: 404 });
  return Response.json(pane);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const pro = getPro();
  if (!pro) return notAvailable();

  let keyRecord;
  try { keyRecord = pro.network.requireNetworkAuth(req); }
  catch (e: any) {
    if (e.name === 'NetworkAuthError') return Response.json({ error: e.message }, { status: 401 });
    throw e;
  }
  if (keyRecord?.permissions !== 'admin') return Response.json({ error: 'Admin permission required' }, { status: 403 });

  const { id } = await params;
  await ensureInitialized();
  const body = await req.json();
  updatePane(id, body);
  return Response.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const pro = getPro();
  if (!pro) return notAvailable();

  let keyRecord;
  try { keyRecord = pro.network.requireNetworkAuth(req); }
  catch (e: any) {
    if (e.name === 'NetworkAuthError') return Response.json({ error: e.message }, { status: 401 });
    throw e;
  }
  if (keyRecord?.permissions !== 'admin') return Response.json({ error: 'Admin permission required' }, { status: 403 });

  const { id } = await params;
  await ensureInitialized();
  deletePane(id);
  return Response.json({ success: true });
}
