'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil, Check, RotateCcw, Maximize2, Minimize2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_TYPES } from '@/lib/agents';
import type { PaneData } from '@/lib/db/queries';
import 'xterm/css/xterm.css';

const WS_PORT = 3458;

interface TerminalPaneProps {
  pane: PaneData;
  onClose: (id: string) => void;
  onUpdate: (id: string, data: Partial<PaneData>) => void;
  isMaximized: boolean;
  onToggleMaximize: (id: string) => void;
  onPopout?: (id: string) => void;
  isPopout?: boolean;
}

export function TerminalPane({ pane, onClose, onUpdate, isMaximized, onToggleMaximize, onPopout, isPopout }: TerminalPaneProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<any>(null);
  const [connected, setConnected] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleValue, setTitleValue] = useState(pane.title);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerPos, setColorPickerPos] = useState({ x: 0, y: 0 });
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const colorPopoverRef = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState(false);

  // Use refs for props so the connect function never needs to re-create.
  // This prevents all terminals from reconnecting when parent state changes.
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Stable connect function — never changes reference
  const connect = useCallback(async () => {
    if (!termRef.current) return;
    const currentPane = paneRef.current;

    const { Terminal } = await import('xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { WebLinksAddon } = await import('@xterm/addon-web-links');

    if (xtermRef.current) {
      xtermRef.current.dispose();
    }

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
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

    const params = new URLSearchParams({
      paneId: currentPane.id,
      cwd: currentPane.cwd,
      agentType: currentPane.agentType || 'shell',
      cols: String(term.cols),
      rows: String(term.rows),
    });
    if (currentPane.claudeSessionId) {
      params.set('agentSession', currentPane.claudeSessionId);
    }
    if (currentPane.customCommand) {
      params.set('customCommand', currentPane.customCommand);
    }

    const ws = new WebSocket(`ws://localhost:${WS_PORT}?${params}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setExited(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          setExited(true);
          term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
        } else if (msg.type === 'error') {
          term.write(`\r\n\x1b[31m${msg.data}\x1b[0m\r\n`);
        } else if (msg.type === 'session-detected') {
          // New Claude session detected — persist session ID so reloads resume it
          onUpdateRef.current(currentPane.id, { claudeSessionId: msg.sessionId });
        }
      } catch {
        // Raw data
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
      term.write('\r\n\x1b[31m[Connection failed - is the terminal server running?]\x1b[0m\r\n');
    };

    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });
  }, []); // Empty deps — uses refs for current values

  // Connect once on mount, clean up on unmount only
  useEffect(() => {
    connect();
    return () => {
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

  // Resize when maximized changes
  useEffect(() => {
    setTimeout(() => {
      if (fitRef.current) {
        try { fitRef.current.fit(); } catch { /* ignore */ }
      }
    }, 50);
  }, [isMaximized]);

  const saveTitle = () => {
    onUpdate(pane.id, { title: titleValue });
    setEditing(false);
  };

  const reconnect = () => {
    wsRef.current?.close();
    xtermRef.current?.dispose();
    setExited(false);
    setTimeout(connect, 100);
  };

  const handlePopout = () => {
    if (onPopout) {
      wsRef.current?.close();
      xtermRef.current?.dispose();
      onPopout(pane.id);
    }
  };

  // Close color picker on outside click
  useEffect(() => {
    if (!showColorPicker) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        colorPickerRef.current && !colorPickerRef.current.contains(target) &&
        colorPopoverRef.current && !colorPopoverRef.current.contains(target)
      ) {
        setShowColorPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColorPicker]);

  const COLORS = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
    '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
    '#d946ef', '#ec4899', '#f43f5e', '#78716c',
  ];

  return (
    <div className={cn(
      'flex flex-col border rounded-lg overflow-hidden',
      isMaximized ? 'fixed inset-2 z-50' : '',
      'border-zinc-700'
    )} style={{ borderColor: `${pane.color}60` }}>
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-xs select-none flex-shrink-0"
        style={{ backgroundColor: `${pane.color}15` }}
      >
        <div ref={colorPickerRef} className="flex-shrink-0">
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setColorPickerPos({ x: rect.left, y: rect.bottom + 6 });
              setShowColorPicker(!showColorPicker);
            }}
            className="w-3 h-3 rounded-full hover:ring-2 hover:ring-zinc-500 ring-offset-1 ring-offset-zinc-900 transition-shadow cursor-pointer"
            style={{ backgroundColor: pane.color }}
            title="Change color"
          />
          {showColorPicker && createPortal(
            <div
              ref={colorPopoverRef}
              className="fixed z-[9999] bg-zinc-800 border border-zinc-600 rounded-xl p-3 shadow-2xl"
              style={{ left: colorPickerPos.x, top: colorPickerPos.y }}
            >
              <div className="grid grid-cols-4 gap-2.5" style={{ width: 132 }}>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      onUpdate(pane.id, { color: c });
                      setShowColorPicker(false);
                    }}
                    className={`w-7 h-7 rounded-full border-2 transition-all hover:scale-110 ${
                      pane.color === c ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:border-zinc-500'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>,
            document.body
          )}
        </div>

        {editing ? (
          <div className="flex items-center gap-1 flex-1">
            <input
              autoFocus
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') { setTitleValue(pane.title); setEditing(false); }
              }}
              className="flex-1 bg-transparent border border-zinc-600 rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-indigo-400"
            />
            <button onClick={saveTitle} className="text-green-400 hover:text-green-300">
              <Check className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 flex-1 min-w-0 group/title">
            <span
              onDoubleClick={() => setEditing(true)}
              className="truncate text-zinc-300 font-medium cursor-default"
            >
              {pane.title}
            </span>
            <button
              onClick={() => setEditing(true)}
              className="text-zinc-600 hover:text-zinc-300 opacity-0 group-hover/title:opacity-100 transition-opacity flex-shrink-0"
              title="Rename"
            >
              <Pencil className="w-2.5 h-2.5" />
            </button>
          </div>
        )}

        <span className="text-[10px] text-zinc-500 truncate max-w-[120px]" title={pane.cwd}>
          {pane.cwd.split(/[/\\]/).pop()}
        </span>

        {pane.agentType && pane.agentType !== 'shell' && (
          <span
            className="text-[9px] px-1.5 py-0.5 rounded font-medium"
            style={{
              backgroundColor: `${AGENT_TYPES[pane.agentType]?.color || '#6366f1'}20`,
              color: AGENT_TYPES[pane.agentType]?.color || '#6366f1',
            }}
          >
            {AGENT_TYPES[pane.agentType]?.name || pane.agentType}
          </span>
        )}

        {!connected && !exited && (
          <span className="text-[10px] text-yellow-500">connecting...</span>
        )}

        {exited && (
          <button onClick={reconnect} className="text-zinc-400 hover:text-white" title="Restart">
            <RotateCcw className="w-3 h-3" />
          </button>
        )}

        {!isPopout && onPopout && (
          <button
            onClick={handlePopout}
            className="text-zinc-400 hover:text-white"
            title="Pop out to new window"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={() => onToggleMaximize(pane.id)}
          className="text-zinc-400 hover:text-white"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>

        <button
          onClick={() => {
            if (confirm('Close this terminal?')) onClose(pane.id);
          }}
          className="text-zinc-400 hover:text-red-400"
          title="Close"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Terminal */}
      <div
        ref={termRef}
        className="flex-1 bg-[#0a0a0a]"
        style={{ minHeight: isMaximized ? 'calc(100vh - 100px)' : '300px' }}
      />
    </div>
  );
}
