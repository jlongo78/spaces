import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getDb } from '@/lib/db/schema';
import { verifyCode, issueTerminalToken } from '@/lib/totp';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const db = getDb();
    const body = await request.json();
    const { code, action } = body;

    const row = db.prepare('SELECT secret, enabled FROM totp WHERE username = ?').get(user) as
      | { secret: string; enabled: number }
      | undefined;

    if (!row) {
      return NextResponse.json({ success: false, error: 'TOTP not set up' }, { status: 400 });
    }

    const valid = verifyCode(row.secret, code);
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Invalid code' }, { status: 401 });
    }

    if (action === 'enable') {
      db.prepare('UPDATE totp SET enabled = 1 WHERE username = ?').run(user);
      return NextResponse.json({ success: true });
    }

    if (action === 'verify') {
      if (!row.enabled) {
        return NextResponse.json({ success: false, error: 'TOTP not enabled yet' }, { status: 400 });
      }
      const token = issueTerminalToken(user);
      return NextResponse.json({ success: true, token });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  });
}
