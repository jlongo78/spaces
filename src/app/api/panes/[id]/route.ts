import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/db/init';
import { getPaneById, updatePane, deletePane } from '@/lib/db/queries';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureInitialized();
  const { id } = await params;
  const pane = getPaneById(id);
  if (!pane) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(pane);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureInitialized();
  const { id } = await params;
  const body = await request.json();
  updatePane(id, body);
  return NextResponse.json({ success: true });
}

// POST used by sendBeacon from popout windows (sendBeacon always POSTs)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureInitialized();
  const { id } = await params;
  const body = await request.json();
  updatePane(id, body);
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureInitialized();
  const { id } = await params;
  deletePane(id);
  return NextResponse.json({ success: true });
}
