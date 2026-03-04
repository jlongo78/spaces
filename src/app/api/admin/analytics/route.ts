import { NextRequest } from 'next/server';
import { getTeams } from '@/lib/teams';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/teams' }, { status: 404 });

export async function GET(req: NextRequest) {
  const teams = getTeams();
  return teams?.admin.api.analytics.GET(req) ?? notAvailable();
}
