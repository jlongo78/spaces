import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

// POST is unauthenticated (receives incoming requests from other nodes)
export async function POST(req: NextRequest) {
  const pro = getPro();
  return pro?.network.api.connectRequest.POST(req) ?? notAvailable();
}

// GET is authenticated (lists pending requests for the UI)
export async function GET() {
  const pro = getPro();
  return pro?.network.api.connectRequest.GET() ?? notAvailable();
}
