import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import { getAuthUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Start a new Claude session (not resuming an existing one)
export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  const body = await request.json();
  const { message, cwd } = body;

  if (!message || typeof message !== 'string') {
    return new Response(JSON.stringify({ error: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const workDir = cwd || `/home/${user}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const args = [
        '-p', message,
        '--output-format', 'stream-json',
        '--verbose',
      ];

      const child = spawn('claude', args, {
        cwd: workDir,
        env: (() => { const e = { ...process.env }; delete e.CLAUDECODE; return e; })(),
        shell: true,
      });

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
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', text })}\n\n`));
      });

      child.on('close', (code) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', exitCode: code })}\n\n`));
        controller.close();
      });

      child.on('error', (err) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', text: err.message })}\n\n`));
        controller.close();
      });

      request.signal.addEventListener('abort', () => {
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
}
