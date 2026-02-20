import { NextRequest, NextResponse } from 'next/server';
import { ensureInitialized } from '@/lib/db/init';
import { getSessions } from '@/lib/db/queries';

export async function GET(request: NextRequest) {
  await ensureInitialized();

  const { searchParams } = request.nextUrl;

  const params = {
    projectId: searchParams.get('projectId') || undefined,
    starred: searchParams.has('starred') ? searchParams.get('starred') === 'true' : undefined,
    tagId: searchParams.has('tagId') ? parseInt(searchParams.get('tagId')!, 10) : undefined,
    search: searchParams.get('search') || undefined,
    sortBy: searchParams.get('sortBy') || 'modified',
    sortDir: searchParams.get('sortDir') || 'DESC',
    offset: parseInt(searchParams.get('offset') || '0', 10),
    limit: parseInt(searchParams.get('limit') || '50', 10),
  };

  const result = getSessions(params);
  return NextResponse.json(result);
}
