import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Not available' }, { status: 404 });

export async function POST(req: NextRequest) {
  const pro = getPro();
  const handler = pro?.network?.api?.connectCallback?.POST;
  return handler ? handler(req) : notAvailable();
}
