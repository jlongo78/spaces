import { NextRequest, NextResponse } from 'next/server';
import { getUser, verifyPassword, updateUser } from '@/lib/db/admin';
import { issueSessionToken, setSessionCookie } from '@/lib/session';
import { generateSecret, verifyCode } from '@/lib/totp';
import QRCode from 'qrcode';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password, totpCode, setupSecret } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
    }

    // Validate credentials
    const user = getUser(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // TOTP flow
    if (!user.totp_enabled) {
      // User hasn't set up TOTP yet
      if (!totpCode) {
        // Step 1: Generate TOTP secret and return QR
        const { secret, uri } = generateSecret(username);
        const qrDataUrl = await QRCode.toDataURL(uri);
        return NextResponse.json({
          status: 'setup-totp',
          setupSecret: secret,
          qrDataUrl,
        });
      }

      // Step 2: Validate code against the setup secret
      if (!setupSecret) {
        return NextResponse.json({ error: 'Setup secret required for first-time TOTP' }, { status: 400 });
      }

      if (!verifyCode(setupSecret, totpCode)) {
        return NextResponse.json({ error: 'Invalid TOTP code' }, { status: 401 });
      }

      // Save TOTP secret and enable
      updateUser(user.id, { totpSecret: setupSecret, totpEnabled: true });

      // Issue session token
      const token = issueSessionToken(username, user.role);
      const response = NextResponse.json({ status: 'ok' });
      setSessionCookie(response, token);
      return response;
    }

    // User has TOTP enabled — require code
    if (!totpCode) {
      return NextResponse.json({ status: 'totp-required' });
    }

    // Validate TOTP code
    if (!verifyCode(user.totp_secret!, totpCode)) {
      return NextResponse.json({ error: 'Invalid TOTP code' }, { status: 401 });
    }

    // Issue session token
    const token = issueSessionToken(username, user.role);
    const response = NextResponse.json({ status: 'ok' });
    setSessionCookie(response, token);
    return response;

  } catch (err: any) {
    console.error('[Auth Login]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
