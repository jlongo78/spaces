import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { isValidKnowledgeType, isValidLayer, getConfidenceBase } from '@/lib/cortex/knowledge/types';
import { layerToScope, scopeToLayer, scopeToLayerKey } from '@/lib/cortex/knowledge/compat';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const { text, type, workspace_id } = body;
    let { layer, scope, sensitivity, origin, entity_links } = body;

    if (!text || !type) {
      return NextResponse.json({ error: 'text and type are required' }, { status: 400 });
    }
    if (!layer && !scope) {
      if (workspace_id) {
        layer = 'workspace';
      } else {
        return NextResponse.json({ error: 'layer or scope is required' }, { status: 400 });
      }
    }
    if (!isValidKnowledgeType(type)) {
      return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 });
    }
    if (layer && !isValidLayer(layer)) {
      return NextResponse.json({ error: `Invalid layer: ${layer}` }, { status: 400 });
    }

    // Resolve layer ↔ scope
    if (scope && !layer) {
      layer = scopeToLayer(scope);
    } else if (layer && !scope) {
      scope = layerToScope(layer, workspace_id);
    }

    const layerKey = scope
      ? scopeToLayerKey(scope, workspace_id)
      : (layer === 'workspace' && workspace_id ? `workspace/${workspace_id}` : layer);

    const [vector] = await cortex.embedding.embed([text]);
    const id = crypto.randomUUID();

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
      scope,
      entity_links: entity_links ?? [],
      evidence_score: getConfidenceBase(type),
      corroborations: 0,
      contradiction_refs: [],
      sensitivity: sensitivity ?? 'internal',
      creator_scope: null,
      origin: origin ?? { source_type: 'manual', source_ref: '', creator_entity_id: `person-${user}` },
      propagation_path: [],
    });

    // Enqueue for distillation if pipeline has it wired
    if (cortex.pipeline?.distillQueue && cortex.pipeline?.distillScheduler) {
      cortex.pipeline.distillQueue.enqueue(id, {
        text,
        layerKey,
        workspaceId: workspace_id || null,
        agentType: 'claude',
      });
      cortex.pipeline.distillScheduler.enqueue([id]);
    }

    console.log(`[Cortex Store] +${type} in ${layerKey}: "${text.slice(0, 60)}..."`);
    return NextResponse.json({ id, success: true });
  });
}
