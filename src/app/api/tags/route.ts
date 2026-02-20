import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/db/init';
import { getAllTags, createTag, deleteTag, updateTagColor } from '@/lib/db/queries';

export async function GET() {
  await ensureInitialized();
  return NextResponse.json(getAllTags());
}

export async function POST(request: NextRequest) {
  await ensureInitialized();
  const body = await request.json();

  if (body.action === 'create') {
    const tag = createTag(body.name, body.color);
    return NextResponse.json(tag);
  }
  if (body.action === 'delete') {
    deleteTag(body.tagId);
    return NextResponse.json({ success: true });
  }
  if (body.action === 'updateColor') {
    updateTagColor(body.tagId, body.color);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
