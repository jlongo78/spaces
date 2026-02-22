import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import DashboardClient from './dashboard-client';
import { HAS_AUTH } from '@/lib/tier';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  if (HAS_AUTH) {
    const cookieStore = await cookies();
    if (!cookieStore.get('spaces-session')) {
      redirect('/login');
    }
  }

  return <DashboardClient />;
}
