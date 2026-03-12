import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { importCortexpack } from '@/lib/cortex/portability/importer';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const tmpPath = path.join(os.tmpdir(), `cortex-import-${Date.now()}.cortexpack`);
    const bytes = await file.arrayBuffer();
    fs.writeFileSync(tmpPath, Buffer.from(bytes));

    const targetLayer = (formData.get('target_layer') as string) || 'workspace';
    const mergeStrategy = (formData.get('merge_strategy') as string) || 'merge';

    importCortexpack(tmpPath, cortex.store, cortex.embedding, {
      targetLayer,
      mergeStrategy: mergeStrategy as any,
      reEmbed: true,
    }).finally(() => {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    });

    return NextResponse.json({ status: 'started' });
  });
}
