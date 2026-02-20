import { WebSocketServer, WebSocket } from 'ws';
import pty from 'node-pty';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { trackMain } from './telemetry';

// Session store: keeps ptys alive across WebSocket reconnections
// Key: paneId, Value: { pty, ws, buffer, exited }
interface Session {
  pty: pty.IPty;
  ws: WebSocket | null;
  buffer: string[];
  exited: boolean;
}

const sessions = new Map<string, Session>();
const MAX_BUFFER_LINES = 500;

// Agent definitions (mirrors src/lib/agents.ts)
const AGENTS: Record<string, { command: string; resumeFlag: string }> = {
  shell:  { command: '',       resumeFlag: '' },
  claude: { command: 'claude', resumeFlag: '--resume' },
  codex:  { command: 'codex',  resumeFlag: '' },
  gemini: { command: 'gemini', resumeFlag: '' },
  aider:  { command: 'aider',  resumeFlag: '' },
  custom: { command: '',       resumeFlag: '' },
};

const UUID_JSONL_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

function findSessionCwd(sessionId: string): string | null {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    if (!fs.existsSync(claudeProjectsDir)) return null;
    const fileName = `${sessionId}.jsonl`;

    for (const projDir of fs.readdirSync(claudeProjectsDir, { withFileTypes: true })) {
      if (!projDir.isDirectory()) continue;
      const filePath = path.join(claudeProjectsDir, projDir.name, fileName);
      if (fs.existsSync(filePath)) {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);

        const chunk = buf.toString('utf-8', 0, bytesRead);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.cwd) {
              console.log(`[Session CWD] ${sessionId.slice(0, 8)}: ${entry.cwd}`);
              return entry.cwd;
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch (err: any) {
    console.error(`[Session CWD] Error looking up ${sessionId}:`, err.message);
  }
  return null;
}

function detectNewClaudeSession(paneId: string, session: Session) {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

  const knownSessionIds = new Set<string>();
  try {
    if (fs.existsSync(claudeProjectsDir)) {
      for (const projDir of fs.readdirSync(claudeProjectsDir, { withFileTypes: true })) {
        if (!projDir.isDirectory()) continue;
        const projPath = path.join(claudeProjectsDir, projDir.name);
        try {
          for (const item of fs.readdirSync(projPath)) {
            const m = item.match(UUID_JSONL_RE);
            if (m) knownSessionIds.add(m[1]);
          }
          const indexPath = path.join(projPath, 'sessions-index.json');
          if (fs.existsSync(indexPath)) {
            try {
              const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
              if (data.entries) {
                for (const entry of data.entries) knownSessionIds.add(entry.sessionId);
              }
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  console.log(`[Session Detect] Pane ${paneId.slice(0, 8)}: snapshot ${knownSessionIds.size} existing sessions`);

  let attempts = 0;
  const maxAttempts = 45;
  const interval = setInterval(() => {
    attempts++;
    if (attempts > maxAttempts || session.exited) {
      clearInterval(interval);
      return;
    }

    try {
      if (!fs.existsSync(claudeProjectsDir)) return;

      for (const projDir of fs.readdirSync(claudeProjectsDir, { withFileTypes: true })) {
        if (!projDir.isDirectory()) continue;
        const projPath = path.join(claudeProjectsDir, projDir.name);
        try {
          for (const item of fs.readdirSync(projPath)) {
            const m = item.match(UUID_JSONL_RE);
            if (m && !knownSessionIds.has(m[1])) {
              const newSessionId = m[1];
              clearInterval(interval);
              console.log(`[Session Detect] Pane ${paneId.slice(0, 8)}: detected session ${newSessionId}`);
              trackMain('claude_session_detected');
              if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                session.ws.send(JSON.stringify({
                  type: 'session-detected',
                  sessionId: newSessionId,
                  paneId,
                }));
              }
              return;
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }, 2000);
}

export function startTerminalWsServer(port: number) {
  const wss = new WebSocketServer({ port });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const paneId = url.searchParams.get('paneId') || crypto.randomUUID();
    const cwd = url.searchParams.get('cwd') || os.homedir();
    const agentType = url.searchParams.get('agentType') || 'shell';
    const agentSession = url.searchParams.get('agentSession') || '';
    const customCommand = url.searchParams.get('customCommand') || '';
    const cols = parseInt(url.searchParams.get('cols') || '120', 10);
    const rows = parseInt(url.searchParams.get('rows') || '30', 10);

    // No TOTP verification needed for local desktop app

    // Check for existing session to reattach
    const existing = sessions.get(paneId);
    if (existing && existing.pty && !existing.exited) {
      existing.ws = ws;

      // Replay buffered output so user sees context
      for (const chunk of existing.buffer) {
        ws.send(JSON.stringify({ type: 'data', data: chunk }));
      }

      try { existing.pty.resize(cols, rows); } catch { /* ignore */ }

      ws.send(JSON.stringify({ type: 'ready', paneId, reattached: true }));
      trackMain('terminal_reattached', { agentType });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'data') {
            existing.pty.write(msg.data);
          } else if (msg.type === 'resize') {
            try { existing.pty.resize(msg.cols, msg.rows); } catch { /* ignore */ }
          }
        } catch {
          existing.pty.write(raw.toString());
        }
      });

      ws.on('close', () => {
        if (existing.ws === ws) existing.ws = null;
      });

      return;
    }

    // Create new pty session — always spawn as the current user
    const isWindows = process.platform === 'win32';
    const shellCmd = isWindows ? 'cmd.exe' : (process.env.SHELL || '/bin/bash');

    const env = { ...process.env };
    delete env.CLAUDECODE;

    console.log(`[Spawn] shell=${shellCmd} cwd=${cwd} agentType=${agentType}`);

    let term: pty.IPty;
    try {
      term = pty.spawn(shellCmd, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
      });
    } catch (err: any) {
      console.error(`[Spawn Error] ${err.message} (cwd=${cwd}, shell=${shellCmd})`);
      ws.send(JSON.stringify({ type: 'error', data: `Failed to spawn: ${err.message}` }));
      ws.close();
      return;
    }

    const session: Session = { pty: term, ws, buffer: [], exited: false };
    sessions.set(paneId, session);
    trackMain('terminal_spawned', { agentType });

    // Inject agent command into the shell
    const agent = AGENTS[agentType] || AGENTS.shell;

    if (agentType !== 'shell') {
      const command = agentType === 'custom' ? customCommand : agent.command;

      if (command) {
        if (agentSession && agentSession !== 'new') {
          if (agentType === 'claude') {
            const sessionCwd = findSessionCwd(agentSession);
            setTimeout(() => {
              if (session.exited) return;
              if (sessionCwd && sessionCwd !== cwd) {
                const cdCmd = isWindows ? `cd /d "${sessionCwd}"` : `cd "${sessionCwd}"`;
                term.write(cdCmd + '\r');
                setTimeout(() => {
                  if (!session.exited) {
                    term.write(`${command} ${agent.resumeFlag} ${agentSession}\r`);
                  }
                }, 300);
              } else {
                term.write(`${command} ${agent.resumeFlag} ${agentSession}\r`);
              }
            }, 500);
          } else if (agent.resumeFlag) {
            setTimeout(() => {
              if (!session.exited) {
                term.write(`${command} ${agent.resumeFlag} ${agentSession}\r`);
              }
            }, 500);
          } else {
            setTimeout(() => {
              if (!session.exited) {
                term.write(`${command}\r`);
              }
            }, 500);
          }
        } else {
          setTimeout(() => {
            if (!session.exited) {
              term.write(`${command}\r`);
            }
          }, 500);
        }
      }
    }

    // pty -> ws (and buffer)
    term.onData((data: string) => {
      session.buffer.push(data);
      if (session.buffer.length > MAX_BUFFER_LINES) {
        session.buffer.shift();
      }

      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    term.onExit(({ exitCode }) => {
      session.exited = true;
      trackMain('terminal_exited', { agentType, exitCode });
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({ type: 'exit', exitCode }));
      }
      setTimeout(() => {
        if (sessions.get(paneId) === session) {
          sessions.delete(paneId);
        }
      }, 30000);
    });

    // ws -> pty
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'data') {
          term.write(msg.data);
        } else if (msg.type === 'resize') {
          try { term.resize(msg.cols, msg.rows); } catch { /* ignore */ }
        }
      } catch {
        term.write(raw.toString());
      }
    });

    ws.on('close', () => {
      if (session.ws === ws) session.ws = null;
    });

    ws.send(JSON.stringify({ type: 'ready', paneId }));

    // Session ID detection for new Claude sessions
    if (agentType === 'claude' && (!agentSession || agentSession === 'new')) {
      detectNewClaudeSession(paneId, session);
    }
  });

  wss.on('error', (err) => {
    console.error('[Terminal Server] Error:', err.message);
  });

  console.log(`[Electron] Terminal WebSocket server running on ws://localhost:${port}`);
}
