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
    // Higher res canvas for readable text on Quest
    const fontSize = 12;
    const charWidth = 7.2;
    const lineHeight = 15;
    const canvasWidth = 2048;
    const canvasHeight = 1024;

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

    let msgCount = 0;

    ws.onmessage = (event) => {
      msgCount++;
      let data = '';
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'data' && msg.data) {
          data = msg.data;
        }
      } catch {
        data = event.data;
      }

      if (data) {
        // Write directly to xterm (skip RAF queue for now)
        term.write(data);
        dirtyRef.current = true;
      }

      // Debug: show message count on canvas every 5 messages
      if (msgCount <= 5 || msgCount % 20 === 0) {
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 60, 400, 20);
        ctx.fillStyle = '#06b6d4';
        ctx.font = '12px monospace';
        ctx.fillText(`Messages: ${msgCount}, data len: ${data.length}, buffer.cursorY: ${term.buffer.active.cursorY}`, 10, 65);
        texture.needsUpdate = true;
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

    const charW = 7.2;
    const lineH = 15;
    const buffer = term.buffer.active;
    const defaultFg = '#e4e4e7';

    // ANSI 256-color palette (first 16)
    const palette = [
      '#27272a', '#ef4444', '#22c55e', '#eab308', '#6366f1', '#a855f7', '#06b6d4', '#e4e4e7',
      '#52525b', '#f87171', '#4ade80', '#facc15', '#818cf8', '#c084fc', '#22d3ee', '#fafafa',
    ];

    // Clear
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    ctx.font = '12px monospace';
    ctx.textBaseline = 'top';

    for (let row = 0; row < rows; row++) {
      const line = buffer.getLine(row + buffer.baseY);
      if (!line) continue;

      let x = 4;
      for (let col = 0; col < cols; col++) {
        const cell = line.getCell(col);
        if (!cell) { x += charW; continue; }

        const char = cell.getChars();
        if (!char || char === ' ') { x += charW; continue; }

        const fgColor = cell.getFgColor();
        // getFgColorMode() returns raw bit flags: 0x1000000=16, 0x2000000=256, 0x3000000=RGB
        const fgModeRaw = cell.getFgColorMode();
        const fgMode = fgModeRaw > 0 ? (fgModeRaw >> 24) || fgModeRaw : 0;

        if (fgMode === 1) {
          ctx.fillStyle = palette[fgColor] || defaultFg;
        } else if (fgMode === 2) {
          ctx.fillStyle = get256Color(fgColor);
        } else if (fgMode === 3) {
          const r = (fgColor >> 16) & 0xff;
          const g = (fgColor >> 8) & 0xff;
          const b = fgColor & 0xff;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
        } else {
          ctx.fillStyle = defaultFg;
        }

        ctx.fillText(char, x, row * lineH + 2);
        x += charW * (cell.getWidth() || 1);
      }
    }

  }

  function get256Color(idx: number): string {
    if (idx < 16) return '#e4e4e7';
    if (idx < 232) {
      const v = idx - 16;
      const b = v % 6; const rest = (v - b) / 6;
      const g = rest % 6; const r = (rest - g) / 6;
      return `rgb(${r * 51},${g * 51},${b * 51})`;
    }
    const gray = 8 + (idx - 232) * 10;
    return `rgb(${gray},${gray},${gray})`;
  }

  const focus = () => {
    const textarea = containerRef.current?.querySelector('.xterm-helper-textarea') as HTMLElement;
    textarea?.focus();
  };

  const scroll = (lines: number) => {
    termRef.current?.scrollLines(lines);
  };

  // Send data to the terminal (for soft keyboard buttons)
  const wsRefStable = useRef<WebSocket | null>(null);
  // Store ws ref for send function
  useEffect(() => {
    // This runs after the main effect, wsRef won't be available here
    // Instead, we'll use the term.onData path - writing to xterm triggers onData which sends to WS
  }, []);

  const send = (data: string) => {
    // Write directly to xterm's input handler, which triggers onData → WebSocket
    const term = termRef.current;
    if (term) {
      // Use xterm's core input handler
      (term as any)._core.coreService.triggerDataEvent(data);
      dirtyRef.current = true;
    }
  };

  return { texture: textureRef, textureReady, term: termRef, focus, scroll, send };
}
