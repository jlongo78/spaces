import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import { IncomingMessage } from 'http';
import crypto from 'crypto';
import { AGENT_TYPES } from '../agents';

interface TermSession {
  pty: pty.IPty;
  ws: WebSocket;
  id: string;
}

const sessions = new Map<string, TermSession>();
const SESSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9\-_.]*$/;

export function startTerminalServer(port = 3458) {
  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port,
    verifyClient: ({ req }: { req: IncomingMessage }) => {
      const origin = req.headers.origin;
      if (!origin) return true;
      try {
        const url = new URL(origin);
        return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      } catch {
        return false;
      }
    },
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const paneId = url.searchParams.get('paneId') || crypto.randomUUID();
    const cwd = url.searchParams.get('cwd') || process.env.HOME || process.env.USERPROFILE || 'C:\\';
    const agentType = url.searchParams.get('agentType') || 'shell';
    const rawSession = url.searchParams.get('agentSession') || url.searchParams.get('claudeSession') || '';
    const sessionId = (rawSession === 'new' || SESSION_ID_RE.test(rawSession)) ? rawSession : '';
    const cols = parseInt(url.searchParams.get('cols') || '120', 10);
    const rows = parseInt(url.searchParams.get('rows') || '30', 10);
    const customModelId = url.searchParams.get('customModelId') || '';

    // Determine shell and args
    const isWindows = process.platform === 'win32';
    let shell: string;
    let args: string[];

    const agent = AGENT_TYPES[agentType];

    if (agent && agent.command) {
      // Resume or start an agent session
      shell = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
      let cmd = agent.command;
      if (sessionId && sessionId !== 'new' && agent.supportsResume) {
        cmd = `${agent.command} ${agent.resumeFlag} ${sessionId}`;
      }
      args = isWindows ? ['/c', cmd] : ['-c', cmd];
    } else {
      // Plain shell or custom command
      const customCommand = url.searchParams.get('customCommand');
      shell = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');
      if (customCommand) {
        args = isWindows ? ['/c', customCommand] : ['-c', customCommand];
      } else {
        args = [];
      }
    }

    // Strip CLAUDECODE to avoid nesting detection
    const env = { ...process.env } as Record<string, string>;
    delete env.CLAUDECODE;

    if (customModelId) {
      const port = process.env.SPACES_PORT || '3457';
      env.OPENAI_URL = `http://localhost:${port}/api/proxy/models/${customModelId}/v1`;
      env.OPENAI_API_KEY = 'sk-custom';
    }

    let term: pty.IPty;
    try {
      term = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
      });
    } catch (err: any) {
      ws.send(JSON.stringify({ type: 'error', data: `Failed to spawn terminal: ${err.message}` }));
      ws.close();
      return;
    }

    const session: TermSession = { pty: term, ws, id: paneId };
    sessions.set(paneId, session);

    // pty -> ws
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    term.onExit(({ exitCode }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode }));
      }
      sessions.delete(paneId);
    });

    // ws -> pty
    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'data') {
          term.write(msg.data);
        } else if (msg.type === 'resize') {
          term.resize(msg.cols, msg.rows);
        }
      } catch {
        // If not JSON, treat as raw input
        term.write(raw.toString());
      }
    });

    ws.on('close', () => {
      term.kill();
      sessions.delete(paneId);
    });

    // Send ready signal
    ws.send(JSON.stringify({ type: 'ready', paneId }));
  });

  wss.on('error', (err) => {
    console.error('[Terminal Server] Error:', err.message);
  });

  console.log(`Terminal WebSocket server running on ws://localhost:${port}`);
  return wss;
}

// For standalone execution
if (require.main === module) {
  startTerminalServer();
}
