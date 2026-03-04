import { getTeams } from '@/lib/teams';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/teams' }, { status: 404 });

export async function POST() {
  const teams = getTeams();
  return teams?.auth.api.logout.POST() ?? notAvailable();
}
