import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';
import { isCortexAvailable } from '@/lib/cortex';
import { readCortexConfig, writeCortexConfig } from '@/lib/cortex/config';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const { configPath } = getUserPaths(user);
    const config = readCortexConfig(configPath);
    return NextResponse.json(config);
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const { configPath } = getUserPaths(user);
    const updates = await request.json();
    writeCortexConfig(configPath, updates);
    return NextResponse.json({ success: true });
  });
}
