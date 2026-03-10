import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ incoming: [], outgoing: [] });

export async function POST(req: NextRequest) {
  const pro = getPro();
  const handler = pro?.network?.api?.connectRequest?.POST;
  return handler ? handler(req) : Response.json({ error: 'Not available' }, { status: 404 });
}

export async function GET() {
  const pro = getPro();
  const handler = pro?.network?.api?.connectRequest?.GET;
  return handler ? handler() : notAvailable();
}
