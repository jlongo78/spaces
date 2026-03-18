import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';
import { readUsage } from '@/lib/cortex/distillation/usage-store';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, () => {
    const { spacesDir } = getUserPaths(user);
    const usagePath = path.join(spacesDir, 'cortex', 'usage.json');
    const usage = readUsage(usagePath);
    return NextResponse.json(usage);
  });
}

export async function DELETE(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const { spacesDir } = getUserPaths(user);
    const usagePath = path.join(spacesDir, 'cortex', 'usage.json');
    try {
      const fs = await import('fs');
      if (fs.existsSync(usagePath)) fs.unlinkSync(usagePath);
    } catch { /* ignore */ }
    return NextResponse.json({ success: true });
  });
}
