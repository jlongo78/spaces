import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { sseManager } from '@/lib/events/sse';
import { initWatcher } from '@/lib/sync/watcher';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);

  // Initialize file watcher on first SSE connection
  initWatcher();

  const stream = new ReadableStream({
    start(controller) {
      const id = Math.random().toString(36).slice(2);
      sseManager.addClient(id, controller);

      // Send initial connection event
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ clientId: id, user })}\n\n`));

      // Keep-alive ping every 30s
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepAlive);
          sseManager.removeClient(id);
        }
      }, 30000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
