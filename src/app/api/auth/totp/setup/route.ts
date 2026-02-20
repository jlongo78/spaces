import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getAuthUser, withUser } from '@/lib/auth';
import { getDb } from '@/lib/db/schema';
import { generateSecret } from '@/lib/totp';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const db = getDb();
    const { secret, uri } = generateSecret(user);
    const qrDataUrl = await QRCode.toDataURL(uri);

    db.prepare(
      'INSERT OR REPLACE INTO totp (username, secret, enabled) VALUES (?, ?, 0)'
    ).run(user, secret);

    return NextResponse.json({ qrDataUrl, secret, uri });
  });
}
