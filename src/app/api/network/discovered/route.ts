import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function GET() {
  const pro = getPro();
  return pro?.network.api.discovered.GET() ?? notAvailable();
}
