import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex } from '@/lib/cortex';
import { cosineSimilarity, detectContradictions } from '@/lib/cortex/knowledge/contradiction';

const CONFIDENCE_DECAY_PER_HOP = 0.8;
const MAX_HOPS = 3;
const DEDUP_THRESHOLD = 0.95;

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const { knowledge, provenance } = body;

    if (!knowledge?.text || !provenance) {
      return NextResponse.json({ error: 'knowledge and provenance required' }, { status: 400 });
    }

    if (provenance.hops && provenance.hops.length >= MAX_HOPS) {
      return NextResponse.json({ status: 'rejected', reason: 'max_hops_exceeded' });
    }

    const [vector] = await cortex.embedding.embed([knowledge.text]);

    const existing = await cortex.store.search('team', vector, 5);
    const isDuplicate = existing.some(
      (e: any) => cosineSimilarity(vector, e.vector) > DEDUP_THRESHOLD
    );
    if (isDuplicate) {
      return NextResponse.json({ status: 'skipped', reason: 'duplicate' });
    }

    const hopCount = (provenance.hops?.length || 0) + 1;
    const adjustedConfidence = knowledge.confidence * Math.pow(CONFIDENCE_DECAY_PER_HOP, hopCount);

    const contradictions = detectContradictions(
      { ...knowledge, vector, id: 'incoming' },
      existing,
      0.85,
    );

    if (contradictions.length > 0) {
      await cortex.store.add('team', {
        ...knowledge,
        id: crypto.randomUUID(),
        vector,
        layer: 'team',
        confidence: adjustedConfidence,
        metadata: {
          ...knowledge.metadata,
          provenance,
          status: 'pending_review',
          contradicts: contradictions.map(c => c.existingId),
        },
      });
      return NextResponse.json({ status: 'pending_review', contradictions: contradictions.length });
    }

    await cortex.store.add('team', {
      ...knowledge,
      id: crypto.randomUUID(),
      vector,
      layer: 'team',
      confidence: adjustedConfidence,
      metadata: { ...knowledge.metadata, provenance, source: 'federation_teach' },
    });

    return NextResponse.json({ status: 'accepted' });
  });
}
