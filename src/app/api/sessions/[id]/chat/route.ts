import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getSessionById } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const body = await request.json();
    const { message, cwd } = body;

    if (!message || typeof message !== 'string') {
      return new Response(JSON.stringify({ error: 'Message is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const session = getSessionById(id);
    const workDir = cwd || session?.projectPath || require('os').homedir();

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        const args = [
          '--resume', id,
          '-p', message,
          '--output-format', 'stream-json',
          '--verbose',
        ];

        // Strip CLAUDECODE so claude doesn't think it's nested
        const env = { ...process.env };
        delete env.CLAUDECODE;

        const child = spawn('claude', args, {
          cwd: workDir,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Close stdin immediately so claude doesn't wait for input
        child.stdin.end();

        // 5-minute timeout
        const timeout = setTimeout(() => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', text: 'Timed out after 5 minutes' })}\n\n`));
          child.kill('SIGTERM');
        }, 5 * 60 * 1000);

        let buffer = '';

        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: line })}\n\n`));
            }
          }
        });

        child.stderr.on('data', (chunk: Buffer) => {
          const text = chunk.toString();
          // Forward stderr as error events
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'stderr', text })}\n\n`));
        });

        child.on('close', (code) => {
          clearTimeout(timeout);
          // Flush remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer);
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            } catch {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text: buffer })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', exitCode: code })}\n\n`));
          controller.close();
        });

        child.on('error', (err) => {
          clearTimeout(timeout);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`));
          controller.close();
        });

        request.signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          child.kill('SIGTERM');
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });
}
