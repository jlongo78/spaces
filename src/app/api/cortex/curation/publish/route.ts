import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { handleToolCall } from '@/lib/cortex/mcp/server';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const result = await handleToolCall('cortex_publish', body, cortex);
    if (result.isError) {
      return NextResponse.json({ error: JSON.parse(result.content[0].text) }, { status: 400 });
    }
    return NextResponse.json(JSON.parse(result.content[0].text));
  });
}
