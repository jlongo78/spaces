'use client';

import { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Terminal } from 'xterm';
import { CanvasAddon } from '@xterm/addon-canvas';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

const WS_PATH = process.env.NEXT_PUBLIC_WS_PATH;

interface VRTerminalProps {
  paneId: string;
  cwd: string;
  agentType: string;
  terminalToken: string;
  cols?: number;
  rows?: number;
  isFocused?: boolean;
}

export function useVRTerminal({
  paneId,
  cwd,
  agentType,
  terminalToken,
  cols = 100,
  rows = 30,
  isFocused = false,
}: VRTerminalProps) {
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const dirtyRef = useRef(true);
  const elapsedRef = useRef(0);
  const [textureReady, setTextureReady] = useState(false);

  useEffect(() => {
    // Create hidden container
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = `${cols * 9}px`;
    container.style.height = `${rows * 18}px`;
    document.body.appendChild(container);
    containerRef.current = container;

    // Create terminal
    const term = new Terminal({
      cols,
      rows,
      cursorBlink: false,
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', monospace",
      scrollback: 1000,
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4e7',
        cursor: '#6366f1',
        selectionBackground: '#6366f180',
        black: '#27272a',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#6366f1',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#e4e4e7',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#818cf8',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#fafafa',
      },
    });

    term.open(container);

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;

    // Mark dirty on any render
    term.onRender(() => { dirtyRef.current = true; });

    // Load CanvasAddon after a frame — it needs the terminal fully rendered in DOM
    let canvasAddon: CanvasAddon | null = null;
    const loadCanvasAddon = () => {
      try {
        canvasAddon = new CanvasAddon();
        term.loadAddon(canvasAddon);
      } catch (e) {
        console.warn('[VRTerminal] CanvasAddon failed, retrying...', e);
        setTimeout(loadCanvasAddon, 200);
        return;
      }
      findCanvas();
    };
    setTimeout(loadCanvasAddon, 50);

    // Find the canvas element created by CanvasAddon
    const findCanvas = () => {
      const canvas = container.querySelector('canvas');
      if (canvas) {
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        textureRef.current = texture;
        setTextureReady(true);
      } else {
        // Canvas not ready yet, retry
        setTimeout(findCanvas, 100);
      }
    };

    // Connect WebSocket
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = process.env.NEXT_PUBLIC_SPACES_BASE_PATH || '';
    const wsPath = WS_PATH || `${basePath}/ws`;
    const params = new URLSearchParams({
      paneId,
      cwd: cwd || '~',
      agentType: agentType || 'shell',
      cols: String(cols),
      rows: String(rows),
    });
    if (terminalToken) params.set('terminalToken', terminalToken);

    const wsUrl = `${proto}//${location.host}${wsPath}?${params}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // RAF-batched write queue (same pattern as terminal-pane.tsx)
    let writeQueue: string[] = [];
    let writeRaf: number | null = null;

    const flushWrites = () => {
      writeRaf = null;
      if (writeQueue.length === 0) return;
      const batch = writeQueue.join('');
      writeQueue = [];
      term.write(batch);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data' && msg.data) {
          writeQueue.push(msg.data);
          if (writeRaf === null) {
            writeRaf = requestAnimationFrame(flushWrites);
          }
        }
      } catch {
        writeQueue.push(event.data);
        if (writeRaf === null) {
          writeRaf = requestAnimationFrame(flushWrites);
        }
      }
    };

    ws.onerror = () => { term.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n'); };
    ws.onclose = () => { term.write('\r\n\x1b[33m[Disconnected]\x1b[0m\r\n'); };

    // Send terminal input back to server
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    return () => {
      if (writeRaf !== null) cancelAnimationFrame(writeRaf);
      ws.close();
      term.dispose();
      container.remove();
      textureRef.current?.dispose();
    };
  }, [paneId, cwd, agentType, terminalToken, cols, rows]);

  // Throttled texture updates via useFrame with frame budget guard
  useFrame((_, delta) => {
    // Frame budget guard: skip background pane updates when frame is slow
    if (delta > 0.016 && !isFocused) return;

    elapsedRef.current += delta;
    const interval = isFocused ? 0.1 : 0.333;

    if (elapsedRef.current >= interval && dirtyRef.current && textureRef.current) {
      textureRef.current.needsUpdate = true;
      dirtyRef.current = false;
      elapsedRef.current = 0;
    }
  });

  // Focus the hidden container to capture keyboard input
  const focus = () => {
    const textarea = containerRef.current?.querySelector('.xterm-helper-textarea') as HTMLElement;
    textarea?.focus();
  };

  // Scroll terminal
  const scroll = (lines: number) => {
    termRef.current?.scrollLines(lines);
  };

  return { texture: textureRef, textureReady, term: termRef, focus, scroll };
}
