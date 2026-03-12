import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable } from '@/lib/cortex';
import { getImportProgress } from '@/lib/cortex/portability/importer';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    return NextResponse.json(getImportProgress());
  });
}
