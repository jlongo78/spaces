import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function POST() {
  const pro = getPro();
  return pro?.auth.api.logout.POST() ?? notAvailable();
}
