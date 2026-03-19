import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { importCortexpack } from '@/lib/cortex/portability/importer';
import { getUserPaths } from '@/lib/config';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json();
      const filename = body.marketplace_file;
      if (!filename) {
        return NextResponse.json({ error: 'marketplace_file is required' }, { status: 400 });
      }
      const safe = path.basename(filename);
      const { spacesDir } = getUserPaths(user);
      const packPath = path.join(spacesDir, 'cortex', 'marketplace', safe);
      if (!fs.existsSync(packPath)) {
        return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
      }

      const targetLayer = body.target_layer || 'workspace';
      const workspaceId = body.workspace_id;
      const effectiveLayer = targetLayer === 'workspace' && workspaceId
        ? `workspace/${workspaceId}` : targetLayer;

      importCortexpack(packPath, cortex.store, cortex.embedding, {
        targetLayer: effectiveLayer,
        mergeStrategy: (body.merge_strategy || 'merge') as any,
        reEmbed: body.re_embed ?? false,
      });
      return NextResponse.json({ status: 'started' });

    } else {
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
      const reEmbed = formData.get('re_embed') === 'true';
      const workspaceId = formData.get('workspace_id') as string | null;
      const effectiveLayer = targetLayer === 'workspace' && workspaceId
        ? `workspace/${workspaceId}` : targetLayer;

      importCortexpack(tmpPath, cortex.store, cortex.embedding, {
        targetLayer: effectiveLayer,
        mergeStrategy: mergeStrategy as any,
        reEmbed,
      }).finally(() => {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      });
      return NextResponse.json({ status: 'started' });
    }
  });
}
