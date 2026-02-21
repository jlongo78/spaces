import { NextRequest, NextResponse } from 'next/server';
import { listUsers, createUser } from '@/lib/db/admin';
import { getAuthRole } from '@/lib/auth';

function requireAdmin(request: NextRequest): NextResponse | null {
  const role = getAuthRole(request);
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const users = listUsers().map(u => ({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    shellUser: u.shell_user,
    role: u.role,
    totpEnabled: !!u.totp_enabled,
    created: u.created,
  }));

  return NextResponse.json(users);
}

export async function POST(request: NextRequest) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const { username, password, displayName, shellUser, role } = body;

    if (!username || !password || !shellUser) {
      return NextResponse.json({ error: 'username, password, and shellUser are required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const user = createUser({
      username,
      password,
      displayName: displayName || username,
      shellUser,
      role: role || 'user',
    });

    return NextResponse.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      shellUser: user.shell_user,
      role: user.role,
      totpEnabled: !!user.totp_enabled,
      created: user.created,
    });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint')) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    }
    console.error('[Admin Users POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
