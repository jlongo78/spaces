import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ nodeId: string; path: string[] }> }) {
  const pro = getPro();
  return pro?.network.api.proxy.GET(req, ctx) ?? notAvailable();
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ nodeId: string; path: string[] }> }) {
  const pro = getPro();
  return pro?.network.api.proxy.POST(req, ctx) ?? notAvailable();
}
