import { NextRequest, NextResponse } from 'next/server';
import { getUserById, updateUser, deleteUser } from '@/lib/db/admin';
import { getAuthRole, getAuthUser } from '@/lib/auth';

function requireAdmin(request: NextRequest): NextResponse | null {
  const role = getAuthRole(request);
  if (role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

function formatUser(u: NonNullable<ReturnType<typeof getUserById>>) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    shellUser: u.shell_user,
    role: u.role,
    totpEnabled: !!u.totp_enabled,
    created: u.created,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  const user = getUserById(id);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json(formatUser(user));
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  const user = getUserById(id);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const body = await request.json();
  const updates: Parameters<typeof updateUser>[1] = {};

  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.shellUser !== undefined) updates.shellUser = body.shellUser;
  if (body.role !== undefined) updates.role = body.role;
  if (body.password !== undefined) {
    if (body.password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    updates.password = body.password;
  }
  if (body.totpReset) {
    updates.totpSecret = null;
    updates.totpEnabled = false;
  }

  updateUser(id, updates);

  const updated = getUserById(id);
  return NextResponse.json(formatUser(updated!));
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireAdmin(request);
  if (denied) return denied;

  const { id } = await params;
  const user = getUserById(id);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Cannot delete yourself
  const currentUser = getAuthUser(request);
  if (user.username === currentUser) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  deleteUser(id);
  return NextResponse.json({ ok: true });
}
