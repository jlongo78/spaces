import { NextResponse } from 'next/server';
import { fullSync, enrichMissingSessions, buildFtsIndex } from '@/lib/sync/indexer';

export async function POST() {
  try {
    const syncResult = await fullSync();
    const enriched = await enrichMissingSessions();

    // Start FTS in background (don't await)
    buildFtsIndex().catch(console.error);

    return NextResponse.json({
      success: true,
      ...syncResult,
      enriched,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
