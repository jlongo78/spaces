import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pro = getPro();
  return pro?.network.api.workspacesById.GET(req, ctx) ?? notAvailable();
}
