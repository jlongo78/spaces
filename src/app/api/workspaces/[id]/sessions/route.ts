import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/db/init';
import { addSessionToWorkspace, removeSessionFromWorkspace } from '@/lib/db/queries';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureInitialized();
  const { id } = await params;
  const body = await request.json();
  addSessionToWorkspace(parseInt(id, 10), body.sessionId);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureInitialized();
  const { id } = await params;
  const body = await request.json();
  removeSessionFromWorkspace(parseInt(id, 10), body.sessionId);
  return NextResponse.json({ success: true });
}
