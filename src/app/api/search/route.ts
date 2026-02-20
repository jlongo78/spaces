import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/db/init';
import { searchSessions } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  await ensureInitialized();

  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q');

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ results: [], query: q });
  }

  const projectId = searchParams.get('projectId') || undefined;
  const limit = parseInt(searchParams.get('limit') || '20', 10);
  const offset = parseInt(searchParams.get('offset') || '0', 10);

  const results = searchSessions(q, { projectId, limit, offset });
  return NextResponse.json({ results, query: q });
}
