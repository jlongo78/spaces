import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pro = getPro();
  return pro?.admin.api.usersById.GET(req, ctx) ?? notAvailable();
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pro = getPro();
  return pro?.admin.api.usersById.PUT(req, ctx) ?? notAvailable();
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pro = getPro();
  return pro?.admin.api.usersById.DELETE(req, ctx) ?? notAvailable();
}
