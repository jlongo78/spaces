import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getSessionById } from '@/lib/db/queries';
import { readMessages } from '@/lib/claude/parser';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const { searchParams } = request.nextUrl;

    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const session = getSessionById(id);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const result = await readMessages(session.fullPath, offset, limit);
    return NextResponse.json(result);
  });
}
