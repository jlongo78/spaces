import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';
import { ensureInitialized } from '@/lib/db/init';
import { getSessionById } from '@/lib/db/queries';
import { readMessages } from '@/lib/claude/parser';

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
  const { searchParams } = req.nextUrl;
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const limit = parseInt(searchParams.get('limit') || '50', 10);

  const session = getSessionById(id);
  if (!session) {
    return Response.json({ error: 'Session not found' }, { status: 404 });
  }

  const result = await readMessages(session.fullPath, offset, limit);
  return Response.json(result);
}
