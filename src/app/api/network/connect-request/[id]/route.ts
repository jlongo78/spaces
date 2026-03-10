import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Not available' }, { status: 404 });

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pro = getPro();
  const handler = pro?.network?.api?.connectRequestById?.PUT;
  return handler ? handler(req, ctx) : notAvailable();
}
