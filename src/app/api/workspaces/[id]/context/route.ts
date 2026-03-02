import { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getTeams } from '@/lib/teams';

const na = () => Response.json({ error: 'Requires @spaces/teams' }, { status: 404 });

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    return getTeams()?.api.context.GET(request, ctx) ?? na();
  });
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    return getTeams()?.api.context.DELETE(request, ctx) ?? na();
  });
}
