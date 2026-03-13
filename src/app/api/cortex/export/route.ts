import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { exportCortexpack } from '@/lib/cortex/portability/exporter';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const outputPath = path.join(os.tmpdir(), `cortex-export-${Date.now()}.cortexpack`);

    const result = await exportCortexpack(cortex.store, outputPath, {
      scope: body.scope || 'full',
      workspaceId: body.workspace_id,
      includeEmbeddings: body.include_embeddings ?? false,
      dimensions: cortex.embedding.dimensions,
    });

    const fileBuffer = fs.readFileSync(result.path);
    fs.unlinkSync(result.path);

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="cortex-export.cortexpack"`,
      },
    });
  });
}
