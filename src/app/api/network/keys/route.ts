import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest) {
  const pro = getPro();
  return pro?.network.api.keys.GET(req) ?? notAvailable();
}

export async function POST(req: NextRequest) {
  const pro = getPro();
  return pro?.network.api.keys.POST(req) ?? notAvailable();
}
