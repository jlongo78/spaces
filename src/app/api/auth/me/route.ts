import { NextRequest, NextResponse } from 'next/server';
import os from 'os';

const isServer = process.env.NEXT_PUBLIC_EDITION === 'server';

export async function GET(request: NextRequest) {
  if (!isServer) {
    // Desktop mode: return local OS user as admin
    return NextResponse.json({
      username: os.userInfo().username,
      role: 'admin',
      displayName: os.userInfo().username,
    });
  }

  const username = request.headers.get('x-auth-user');
  const role = request.headers.get('x-auth-role') || 'user';

  if (!username) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Look up display name from admin DB
  try {
    const { getUser } = require('@/lib/db/admin');
    const user = getUser(username);
    return NextResponse.json({
      username,
      role,
      displayName: user?.display_name || username,
    });
  } catch {
    return NextResponse.json({
      username,
      role,
      displayName: username,
    });
  }
}
