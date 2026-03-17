import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex } from '@/lib/cortex';
import { getDb } from '@/lib/db/schema';
import { LobeShareStore } from '@/lib/cortex/lobes/shares';
import { slugify } from '@/lib/cortex/graph/types';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    // Ensure Cortex is available before serving share data
    const cortex = await getCortex();
    if (!cortex) {
      return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });
    }

    const userId = `person-${slugify(user)}`;
    const db = getDb();
    const store = new LobeShareStore(db);

    const incoming = store.listIncoming(userId);
    const outgoing = store.listOutgoing(userId);

    return NextResponse.json({ incoming, outgoing });
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const cortex = await getCortex();
    if (!cortex) {
      return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });
    }

    const userId = `person-${slugify(user)}`;
    const db = getDb();
    const store = new LobeShareStore(db);

    const body = await request.json();
    const { action, shareId, workspaceId, lobeName, sharedWithUserId } = body;

    if (action === 'share') {
      if (!workspaceId || !lobeName || !sharedWithUserId) {
        return NextResponse.json(
          { error: 'workspaceId, lobeName, and sharedWithUserId are required' },
          { status: 400 },
        );
      }
      const share = store.share({
        id: crypto.randomUUID(),
        ownerUserId: userId,
        ownerWorkspaceId: Number(workspaceId),
        ownerLobeName: lobeName,
        sharedWithUserId,
      });
      return NextResponse.json({ share });
    }

    if (action === 'accept') {
      if (!shareId) {
        return NextResponse.json({ error: 'shareId is required' }, { status: 400 });
      }
      store.accept(shareId);
      return NextResponse.json({ success: true });
    }

    if (action === 'revoke' || action === 'decline') {
      if (!shareId) {
        return NextResponse.json({ error: 'shareId is required' }, { status: 400 });
      }
      store.revoke(shareId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  });
}
