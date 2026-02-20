import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getDb } from '@/lib/db/schema';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, () => {
    const db = getDb();
    const row = db.prepare('SELECT enabled FROM totp WHERE username = ?').get(user) as
      | { enabled: number }
      | undefined;

    return NextResponse.json({
      enabled: row?.enabled === 1,
      required: true,
    });
  });
}
