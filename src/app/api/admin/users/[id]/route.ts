import { NextRequest } from 'next/server';
import { getTeams } from '@/lib/teams';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/teams' }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const teams = getTeams();
  return teams?.admin.api.usersById.GET(req, ctx) ?? notAvailable();
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const teams = getTeams();
  return teams?.admin.api.usersById.PUT(req, ctx) ?? notAvailable();
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const teams = getTeams();
  return teams?.admin.api.usersById.DELETE(req, ctx) ?? notAvailable();
}
