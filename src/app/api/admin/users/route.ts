import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest) {
  const pro = getPro();
  return pro?.admin.api.users.GET(req) ?? notAvailable();
}

export async function POST(req: NextRequest) {
  const pro = getPro();
  return pro?.admin.api.users.POST(req) ?? notAvailable();
}
