import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getPaneById, updatePane, deletePane } from '@/lib/db/queries';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const pane = getPaneById(id);
    if (!pane) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(pane);
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const body = await request.json();
    updatePane(id, body);
    return NextResponse.json({ success: true });
  });
}

// POST used by sendBeacon from popout windows (sendBeacon always POSTs)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const body = await request.json();
    updatePane(id, body);
    return NextResponse.json({ success: true });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    deletePane(id);
    return NextResponse.json({ success: true });
  });
}
