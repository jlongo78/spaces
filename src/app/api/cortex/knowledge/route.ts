import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { isValidKnowledgeType, isValidLayer } from '@/lib/cortex/knowledge/types';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const { text, type, layer, workspace_id } = body;

    if (!text || !type || !layer) {
      return NextResponse.json({ error: 'text, type, and layer required' }, { status: 400 });
    }
    if (!isValidKnowledgeType(type)) {
      return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 });
    }
    if (!isValidLayer(layer)) {
      return NextResponse.json({ error: `Invalid layer: ${layer}` }, { status: 400 });
    }

    const [vector] = await cortex.embedding.embed([text]);
    const id = crypto.randomUUID();
    const layerKey = layer === 'workspace' && workspace_id
      ? `workspace/${workspace_id}` : layer;

    await cortex.store.add(layerKey, {
      id,
      vector,
      text,
      type,
      layer,
      workspace_id: workspace_id || null,
      session_id: null,
      agent_type: 'claude',
      project_path: null,
      file_refs: [],
      confidence: 0.95,
      created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(),
      stale_score: 0,
      access_count: 0,
      last_accessed: null,
      metadata: { source: 'user_teach' },
    });

    return NextResponse.json({ id, success: true });
  });
}
