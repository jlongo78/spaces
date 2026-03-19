import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';
import { ensureInitialized } from '@/lib/db/init';
import { getPanesByWorkspace } from '@/lib/db/queries';
import { withUser } from '@/lib/auth';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const pro = getPro();
  if (!pro) return notAvailable();

  let keyRecord;
  try {
    keyRecord = pro.network.requireNetworkAuth(req);
  } catch (e: any) {
    if (e.name === 'NetworkAuthError') {
      return Response.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const { id } = await params;
  const keyUser = keyRecord?.username;

  const handler = async () => {
    await ensureInitialized();
    const panes = getPanesByWorkspace(parseInt(id, 10));
    return Response.json({ panes });
  };

  return keyUser ? withUser(keyUser, handler) : handler();
}
