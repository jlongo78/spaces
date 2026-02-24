'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { MobileTerminalToolbar } from './mobile-terminal-toolbar';
import { MobileTerminalInput } from './mobile-terminal-input';
import { useIdleDetection } from '@/hooks/use-idle-detection';
import type { IdleState } from '@/hooks/use-idle-detection';
import type { PaneData } from '@/lib/db/queries';
import 'xterm/css/xterm.css';

const WS_PATH = process.env.NEXT_PUBLIC_WS_PATH;

interface MobileTerminalPaneProps {
  pane: PaneData;
  terminalToken: string;
  isVisible: boolean;
  onIdleChange?: (paneId: string, state: IdleState) => void;
  onUserInput?: (paneId: string) => void;
}

export function MobileTerminalPane({ pane, terminalToken, isVisible, onIdleChange, onUserInput }: MobileTerminalPaneProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [exited, setExited] = useState(false);

  const paneRef = useRef(pane);
  paneRef.current = pane;
  const tokenRef = useRef(terminalToken);
  tokenRef.current = terminalToken;
  const onUserInputRef = useRef(onUserInput);
  onUserInputRef.current = onUserInput;

  const { idleState, markConnected, markDataReceived, markUserInput, markDisconnected } = useIdleDetection({
    paneId: pane.id,
    onIdleChange,
  });

  // Track exited state for idle — exited panes should be 'initializing', not 'idle'
  const exitedRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const connect = useCallback(async () => {
    if (!termRef.current) return;
    const currentPane = paneRef.current;
    intentionalCloseRef.current = false;
    reconnectAttemptsRef.current = 0;

    const { Terminal } = await import('xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { WebLinksAddon } = await import('@xterm/addon-web-links');

    if (xtermRef.current) {
      xtermRef.current.dispose();
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 16,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      theme: {
        background: '#0a0a0a',
        foreground: '#e4e4e7',
        cursor: '#6366f1',
        selectionBackground: '#6366f133',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    term.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitRef.current = fitAddon;

    // Build WebSocket URL from current pane state
    const buildWsUrl = () => {
      const p = paneRef.current;
      const params = new URLSearchParams({
        paneId: p.id,
        cwd: p.cwd,
        agentType: p.agentType || 'shell',
        cols: String(term.cols),
        rows: String(term.rows),
      });
      if (p.claudeSessionId) params.set('agentSession', p.claudeSessionId);
      if (p.customCommand) params.set('customCommand', p.customCommand);
      const token = tokenRef.current;
      if (token) params.set('terminalToken', token);
      const wsPath = WS_PATH || '/ws';
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${location.host}${wsPath}?${params}`;
    };

    // Open (or re-open) WebSocket and wire to the existing terminal
    const openWs = () => {
      if (intentionalCloseRef.current) return;

      // On reconnect, clear terminal so server buffer replay is clean
      if (reconnectAttemptsRef.current > 0) {
        term.write('\x1b[2J\x1b[H');
        term.clear();
      }

      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setExited(false);
        exitedRef.current = false;
        reconnectAttemptsRef.current = 0;
        markConnected();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'data') {
            term.write(msg.data);
            if (!exitedRef.current) markDataReceived();
          } else if (msg.type === 'exit') {
            setExited(true);
            exitedRef.current = true;
            markDisconnected();
            term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
          } else if (msg.type === 'error') {
            term.write(`\r\n\x1b[31m${msg.data}\x1b[0m\r\n`);
          }
        } catch {
          // Raw data
        }
      };

      ws.onclose = () => {
        setConnected(false);
        markDisconnected();
        // Auto-reconnect if the process didn't exit and we didn't intentionally close
        if (!exitedRef.current && !intentionalCloseRef.current) {
          const attempts = reconnectAttemptsRef.current;
          if (attempts < 20) {
            const delay = Math.min(1000 * Math.pow(1.5, attempts), 30000);
            reconnectAttemptsRef.current = attempts + 1;
            reconnectTimerRef.current = setTimeout(openWs, delay);
          }
        }
      };

      ws.onerror = () => {
        setConnected(false);
        markDisconnected();
      };
    };

    // Wire terminal input/resize to current WebSocket via ref
    term.onData((data: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'data', data }));
        markUserInput();
        onUserInputRef.current?.(paneRef.current.id);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    openWs();
  }, [markConnected, markDataReceived, markUserInput, markDisconnected]);

  useEffect(() => {
    connect();
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      xtermRef.current?.dispose();
    };
  }, [connect]);

  // Resize on container changes
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (fitRef.current) {
        try { fitRef.current.fit(); } catch { /* ignore */ }
      }
    });
    if (termRef.current) {
      observer.observe(termRef.current);
    }
    return () => observer.disconnect();
  }, []);

  // Refit xterm when becoming visible
  useEffect(() => {
    if (isVisible && fitRef.current) {
      const timer = setTimeout(() => {
        try { fitRef.current?.fit(); } catch { /* ignore */ }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  const sendData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'data', data }));
      markUserInput();
      onUserInputRef.current?.(paneRef.current.id);
    }
  }, [markUserInput]);

  const reconnect = () => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    xtermRef.current?.dispose();
    setExited(false);
    exitedRef.current = false;
    setTimeout(connect, 100);
  };

  return (
    <div className={
      isVisible
        ? 'flex flex-col flex-1 min-h-0'
        : 'invisible absolute inset-0 pointer-events-none flex flex-col flex-1 min-h-0'
    }>
      {/* Status bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 border-b border-zinc-800 text-xs flex-shrink-0">
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: pane.color }}
        />
        <span className="font-medium truncate flex-1">{pane.title}</span>
        {!connected && !exited && (
          <span className="text-yellow-500">connecting...</span>
        )}
        {exited && (
          <button onClick={reconnect} className="text-indigo-400 text-xs">
            Restart
          </button>
        )}
      </div>

      {/* Terminal */}
      <div
        ref={termRef}
        className="flex-1 bg-[#0a0a0a]"
        style={{ minHeight: '200px' }}
      />

      {/* Modifier key toolbar */}
      <MobileTerminalToolbar onSend={sendData} />

      {/* Compose input bar */}
      <MobileTerminalInput onSend={sendData} />
    </div>
  );
}
