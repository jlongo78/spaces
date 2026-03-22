'use client';

import { useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Terminal } from 'xterm';

const WS_PATH = process.env.NEXT_PUBLIC_WS_PATH;

// ANSI color palette for rendering
const ANSI_COLORS: Record<number, string> = {
  0: '#27272a', 1: '#ef4444', 2: '#22c55e', 3: '#eab308',
  4: '#6366f1', 5: '#a855f7', 6: '#06b6d4', 7: '#e4e4e7',
  8: '#52525b', 9: '#f87171', 10: '#4ade80', 11: '#facc15',
  12: '#818cf8', 13: '#c084fc', 14: '#22d3ee', 15: '#fafafa',
};

interface VRTerminalProps {
  paneId: string;
  cwd: string;
  agentType: string;
  terminalToken: string;
  cols?: number;
  rows?: number;
  isFocused?: boolean;
}

/**
 * Renders xterm buffer content directly to a canvas using 2D context.
 * Bypasses CanvasAddon entirely — works on Quest browser.
 */
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dirtyRef = useRef(true);
  const elapsedRef = useRef(0);
  const [textureReady, setTextureReady] = useState(false);

  useEffect(() => {
    // Create our own canvas for rendering terminal text
    const charWidth = 10;
    const charHeight = 18;
    // Power-of-two dimensions for GPU compatibility
    const canvasWidth = 1024;
    const canvasHeight = 512;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvasRef.current = canvas;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctxRef.current = ctx;

    // Fill with terminal background and show initial status
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = '#888888';
    ctx.font = '16px monospace';
    ctx.fillText(`Connecting to ${paneId.slice(0, 8)}...`, 10, 20);

    // Create texture from our canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textureRef.current = texture;
    setTextureReady(true);

    // Create hidden container for xterm (it needs a DOM element)
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    container.style.width = `${cols * 10}px`;
    container.style.height = `${rows * 20}px`;
    document.body.appendChild(container);
    containerRef.current = container;

    // Create terminal (DOM renderer only — no CanvasAddon needed)
    const term = new Terminal({
      cols,
      rows,
      cursorBlink: false,
      scrollback: 1000,
    });
    term.open(container);
    termRef.current = term;

    // When terminal renders, mark dirty so we redraw our canvas
    term.onRender(() => { dirtyRef.current = true; });

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
    console.log('[VRTerminal] Connecting:', wsUrl);

    // Draw WebSocket URL on canvas for debugging
    ctx.fillStyle = '#666666';
    ctx.font = '12px monospace';
    ctx.fillText(`WS: ${wsUrl.slice(0, 80)}`, 10, 40);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[VRTerminal] WebSocket connected');
      ctx.fillStyle = '#22c55e';
      ctx.fillText('WebSocket connected!', 10, 60);
      texture.needsUpdate = true;
    };

    // RAF-batched write queue
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
          if (writeRaf === null) writeRaf = requestAnimationFrame(flushWrites);
        }
      } catch {
        writeQueue.push(event.data);
        if (writeRaf === null) writeRaf = requestAnimationFrame(flushWrites);
      }
    };

    ws.onerror = (e) => {
      console.error('[VRTerminal] WebSocket error', e);
      ctx.fillStyle = '#ef4444';
      ctx.fillText('WebSocket ERROR', 10, 60);
      texture.needsUpdate = true;
      term.write('\r\n\x1b[31m[WebSocket error]\x1b[0m\r\n');
    };
    ws.onclose = (e) => {
      console.log('[VRTerminal] WebSocket closed', e.code, e.reason);
      ctx.fillStyle = '#eab308';
      ctx.fillText(`WebSocket closed: ${e.code} ${e.reason}`, 10, 80);
      texture.needsUpdate = true;
      term.write('\r\n\x1b[33m[Disconnected]\x1b[0m\r\n');
    };

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

  // Throttled: read xterm buffer → draw to canvas → update texture
  useFrame((_, delta) => {
    if (delta > 0.016 && !isFocused) return;

    elapsedRef.current += delta;
    const interval = isFocused ? 0.1 : 0.333;

    if (elapsedRef.current >= interval && dirtyRef.current && textureRef.current) {
      renderTerminalToCanvas();
      textureRef.current.needsUpdate = true;
      dirtyRef.current = false;
      elapsedRef.current = 0;
    }
  });

  function renderTerminalToCanvas() {
    const term = termRef.current;
    const ctx = ctxRef.current;
    if (!term || !ctx) return;

    const charWidth = 10;
    const charHeight = 18;
    const buffer = term.buffer.active;

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Use monospace — guaranteed available on all platforms including Quest
    ctx.font = '14px monospace';
    ctx.textBaseline = 'top';

    for (let row = 0; row < rows; row++) {
      const line = buffer.getLine(row + buffer.baseY);
      if (!line) continue;

      let x = 0;
      for (let col = 0; col < cols; col++) {
        const cell = line.getCell(col);
        if (!cell) { x += charWidth; continue; }

        const char = cell.getChars();
        if (!char || char === ' ') { x += charWidth; continue; }

        // Get foreground color
        const fg = cell.getFgColor();
        const fgMode = cell.getFgColorMode();

        if (fgMode === 1) {
          // Palette color (16 basic)
          ctx.fillStyle = ANSI_COLORS[fg] || '#e4e4e7';
        } else if (fgMode === 2) {
          // RGB color
          const r = (fg >> 16) & 0xff;
          const g = (fg >> 8) & 0xff;
          const b = fg & 0xff;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          // Default foreground
          ctx.fillStyle = '#e4e4e7';
        }

        ctx.fillText(char, x, row * charHeight + 2);
        x += charWidth * cell.getWidth();
      }
    }
  }

  const focus = () => {
    const textarea = containerRef.current?.querySelector('.xterm-helper-textarea') as HTMLElement;
    textarea?.focus();
  };

  const scroll = (lines: number) => {
    termRef.current?.scrollLines(lines);
  };

  return { texture: textureRef, textureReady, term: termRef, focus, scroll };
}
