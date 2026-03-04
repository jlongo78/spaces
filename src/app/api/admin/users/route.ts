import { NextRequest } from 'next/server';
import { getTeams } from '@/lib/teams';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/teams' }, { status: 404 });

export async function GET(req: NextRequest) {
  const teams = getTeams();
  return teams?.admin.api.users.GET(req) ?? notAvailable();
}

export async function POST(req: NextRequest) {
  const teams = getTeams();
  return teams?.admin.api.users.POST(req) ?? notAvailable();
}
