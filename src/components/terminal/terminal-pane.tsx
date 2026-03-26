'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Pencil, Check, RotateCcw, Maximize2, Minimize2, ExternalLink, Globe, Users, Mic, MicOff, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_TYPES } from '@/lib/agents';
import { useTier } from '@/hooks/use-tier';
import { InjectionBadge } from '@/components/cortex/injection-badge';

import type { PaneData } from '@/lib/db/queries';
import 'xterm/css/xterm.css';

const WS_PATH = process.env.NEXT_PUBLIC_WS_PATH;

interface TerminalPaneProps {
  pane: PaneData;
  onClose: (id: string) => void;
  onUpdate: (id: string, data: Partial<PaneData>) => void;
  isMaximized: boolean;
  onToggleMaximize: (id: string) => void;
  onPopout?: (id: string) => void;
  onBrowse?: (cwd: string) => void;
  isPopout?: boolean;
  terminalToken?: string;
  workspaceCollaboration?: boolean;
}

export function TerminalPane({ pane, onClose, onUpdate, isMaximized, onToggleMaximize, onPopout, onBrowse, isPopout, terminalToken, workspaceCollaboration }: TerminalPaneProps) {
  const { hasCortex } = useTier();
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<any>(null);

  // RAF-batched write queue — coalesces rapid WebSocket messages into single frame updates
  // to prevent scroll jitter from hundreds of write() calls per second
  const writeQueueRef = useRef('');
  const writeRafRef = useRef<number | null>(null);

  const queueWrite = (data: string) => {
    writeQueueRef.current += data;
    if (writeRafRef.current === null) {
      writeRafRef.current = requestAnimationFrame(() => {
        writeRafRef.current = null;
        let queued = writeQueueRef.current;
        writeQueueRef.current = '';
        if (queued && xtermRef.current) {
          // Strip \x1b[3J (clear scrollback) — Claude Code sends this when re-rendering
          // its UI, which teleports the viewport to the top. Preserving scrollback is
          // more important for our use case.
          queued = queued.replace(/\x1b\[3J/g, '');
          xtermRef.current.write(queued);
        }
      });
    }
  };

  // Simple fit — xterm.js internally handles scroll preservation via
  // _suppressOnScrollHandler in Viewport._sync() and isUserScrolling in BufferService
  const safeFit = () => {
    try { fitRef.current?.fit(); } catch { /* ignore */ }
  };
  const [connected, setConnected] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleValue, setTitleValue] = useState(pane.title);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorPickerPos, setColorPickerPos] = useState({ x: 0, y: 0 });
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const colorPopoverRef = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState(false);
  const [injectionCount, setInjectionCount] = useState(0);
  const [injectionItems, setInjectionItems] = useState<Array<{ type: string; text: string }>>([]);

  // Quest browser detection + voice state
  const [isQuest, setIsQuest] = useState(false);
  const [isImmersiveVoice, setIsImmersiveVoice] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'transcribing' | 'waiting'>('idle');
  const immersiveRef = useRef(false);
  const [questInput, setQuestInput] = useState('');
  const questInputRef = useRef<HTMLInputElement>(null);
  const [questMicActive, setQuestMicActive] = useState(false);
  const questRecorderRef = useRef<MediaRecorder | null>(null);
  const [questKeyboardOpen, setQuestKeyboardOpen] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || '';
    setIsQuest(/Quest|Oculus|Pacific/i.test(ua));
  }, []);

  // Use refs for props so the connect function never needs to re-create.
  // This prevents all terminals from reconnecting when parent state changes.
  const paneRef = useRef(pane);
  paneRef.current = pane;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const terminalTokenRef = useRef(terminalToken);
  terminalTokenRef.current = terminalToken;

  // Upload handler ref (used inside connect callback which captures refs)
  const uploadFilesRef = useRef<(files: File[]) => void>(() => {});

  // Auto-reconnect state
  const exitedRef = useRef(false);
  const intentionalCloseRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Stable connect function — never changes reference
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

    const isQuestUA = /Quest|Oculus|Pacific/i.test(navigator.userAgent);
    const term = new Terminal({
      cursorBlink: !isQuestUA,
      disableStdin: isQuestUA,  // On Quest, input goes through the visible input field instead
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace",
      scrollback: 10000,           // Cap scrollback buffer (default is unlimited → OOM on heavy output)
      fastScrollModifier: 'alt',   // Alt+scroll for fast scrolling
      smoothScrollDuration: 0,     // Disable smooth scroll animation (prevents jank on rapid output)
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

    // Defer open by one frame so the container has layout dimensions (fixes Windows xterm crash)
    await new Promise<void>((resolve) => requestAnimationFrame(() => {
      if (termRef.current) {
        term.open(termRef.current);
        try { fitAddon.fit(); } catch { /* dimensions may be wrong — corrected below */ }

        // On Quest: hide xterm's internal textarea so it can't grab focus and pop up the keyboard
        if (isQuestUA && termRef.current) {
          const textarea = termRef.current.querySelector('textarea');
          if (textarea) {
            textarea.setAttribute('readonly', 'true');
            textarea.setAttribute('inputmode', 'none');
            textarea.style.opacity = '0';
            textarea.style.pointerEvents = 'none';
          }
        }
      }
      resolve();
    }));

    // Ctrl-C copies when there's a selection, Ctrl-V pastes from clipboard
    term.attachCustomKeyEventHandler((ev: KeyboardEvent) => {
      if (ev.type !== 'keydown') return true;
      if (ev.ctrlKey && ev.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
        return false;
      }
      if (ev.ctrlKey && ev.key === 'v') {
        ev.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'data', data: text }));
          }
        });
        return false;
      }
      return true;
    });

    // xterm.js tracks scroll state internally (isUserScrolling flag in BufferService)
    // — no manual tracking needed. write() won't auto-scroll when user is scrolled up.

    xtermRef.current = term;
    fitRef.current = fitAddon;

    // The initial fit() above kicks xterm's canvas renderer into life but the
    // CSS grid may not have settled yet, giving wrong cols/rows.  A double-rAF
    // waits for a full layout+paint cycle; the 300ms fallback catches slow grids.
    requestAnimationFrame(() => requestAnimationFrame(safeFit));
    setTimeout(safeFit, 300);

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
      if (p.nodeId) params.set('nodeId', p.nodeId);
      const token = terminalTokenRef.current;
      if (token) params.set('terminalToken', token);
      const basePath = process.env.SPACES_BASE_PATH || '';
      const wsPath = WS_PATH || `${basePath}/ws`;
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
        // Re-fit after connection — the CSS grid layout may not have been
        // stable when the terminal first opened, so cols/rows in the URL
        // can be wrong.  A delayed fit + resize message corrects this.
        setTimeout(safeFit, 150);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'data') {
            queueWrite(msg.data);
          } else if (msg.type === 'exit') {
            setExited(true);
            exitedRef.current = true;
            const reason = msg.reason ? ` — ${msg.reason}` : '';
            term.write(`\r\n\x1b[90m[Process exited with code ${msg.exitCode}${reason}]\x1b[0m\r\n`);
          } else if (msg.type === 'error') {
            term.write(`\r\n\x1b[31m${msg.data}\x1b[0m\r\n`);
          } else if (msg.type === 'session-detected') {
            onUpdateRef.current(paneRef.current.id, { claudeSessionId: msg.sessionId });
          } else if (msg.type === 'cortex-injection') {
            setInjectionCount(msg.count || 0);
            if (msg.items) setInjectionItems(msg.items);
          } else if (msg.type === 'collab-updated') {
            onUpdateRef.current(paneRef.current.id, { isCollaborating: msg.isCollaborating });
          }
        } catch {
          // Raw data
        }
      };

      ws.onclose = () => {
        setConnected(false);
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
      };
    };

    // Wire terminal input/resize to current WebSocket via ref
    term.onData((data: string) => {
      // xterm.js auto-scrolls to bottom on user input (scrollOnUserInput option)
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'data', data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    openWs();
  }, []); // Empty deps — uses refs for current values

  // Connect once on mount, clean up on unmount only
  useEffect(() => {
    connect();
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      xtermRef.current?.dispose();
    };
  }, [connect]);

  // Resize on container changes.  The ResizeObserver fires immediately on
  // observe(), but fitRef may not be set yet (connect() is async).  Using rAF
  // coalesces rapid resize events and gives connect() time to finish.
  useEffect(() => {
    let rafId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(safeFit);
    });
    if (termRef.current) {
      observer.observe(termRef.current);
    }
    return () => { cancelAnimationFrame(rafId); observer.disconnect(); };
  }, []);

  // Resize when maximized changes or Quest toolbar appears/disappears
  useEffect(() => {
    setTimeout(safeFit, 50);
  }, [isMaximized, isQuest]);

  const saveTitle = () => {
    onUpdate(pane.id, { title: titleValue });
    setEditing(false);
  };

  const reconnect = () => {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    wsRef.current?.close();
    xtermRef.current?.dispose();
    setExited(false);
    exitedRef.current = false;
    setTimeout(connect, 100);
  };

  const handlePopout = () => {
    if (onPopout) {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      xtermRef.current?.dispose();
      onPopout(pane.id);
    }
  };

  // ─── Quest toolbar: send keystrokes to terminal ───
  const sendKey = (key: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'data', data: key }));
    }
  };

  // Send text as a bracketed paste — terminal treats it as a single block
  // instead of processing character-by-character (prevents prompt redraw glitches)
  const sendPaste = (text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const bracketed = `\x1b[200~${text}\x1b[201~`;
      wsRef.current.send(JSON.stringify({ type: 'data', data: bracketed }));
    }
  };

  // ─── Quest Whisper mic: record → Groq/Whisper → text into input field ───
  const toggleQuestMic = async () => {
    if (questMicActive) {
      // Stop recording
      if (questRecorderRef.current?.state === 'recording') questRecorderRef.current.stop();
      return;
    }

    setQuestMicActive(true);
    try {
      // Get Groq/Whisper config for direct browser call (no server proxy)
      const cfgRes = await fetch('/api/whisper/config');
      const cfg = cfgRes.ok ? await cfgRes.json() : null;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      let hasSpeech = false;

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        try { source.disconnect(); } catch {}
        try { audioCtx.close(); } catch {}
        questRecorderRef.current = null;

        if (!hasSpeech || chunks.length === 0) { setQuestMicActive(false); return; }

        const blob = new Blob(chunks, { type: 'audio/webm' });
        if (blob.size < 500) { setQuestMicActive(false); return; }

        try {
          let text = '';
          if (cfg?.apiKey) {
            // Direct call to Groq/OpenAI — skip server proxy for speed
            const form = new FormData();
            form.append('file', blob, 'audio.webm');
            form.append('model', cfg.model);
            form.append('response_format', 'json');
            form.append('language', 'en');
            const res = await fetch(cfg.apiUrl, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${cfg.apiKey}` },
              body: form,
            });
            if (res.ok) {
              const data = await res.json();
              text = data.text || '';
            }
          } else {
            // Fallback to server proxy
            const form = new FormData();
            form.append('audio', blob, 'dictation.webm');
            const res = await fetch('/api/whisper', { method: 'POST', body: form });
            if (res.ok) {
              const data = await res.json();
              text = data.text || '';
            }
          }
          if (text.trim()) {
            setQuestInput(prev => prev ? `${prev} ${text.trim()}` : text.trim());
          }
        } catch {}
        setQuestMicActive(false);
      };

      // VAD: detect speech, stop after 1s silence (fast trigger)
      const dataArr = new Uint8Array(analyser.frequencyBinCount);
      let lastSpeechTime = 0;
      let speechFrames = 0;
      const startTime = Date.now();

      const checkVAD = () => {
        if (!questRecorderRef.current || questRecorderRef.current.state !== 'recording') return;

        analyser.getByteFrequencyData(dataArr);
        const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;

        if (avg > 20) {
          speechFrames++;
          lastSpeechTime = Date.now();
          if (speechFrames >= 10) hasSpeech = true;
        } else if (!hasSpeech) {
          speechFrames = 0;
        }

        if (hasSpeech && Date.now() - lastSpeechTime > 1000) {
          questRecorderRef.current.stop();
          return;
        }
        if (!hasSpeech && Date.now() - startTime > 10000) {
          questRecorderRef.current.stop();
          return;
        }
        requestAnimationFrame(checkVAD);
      };

      recorder.start(250);
      questRecorderRef.current = recorder;
      requestAnimationFrame(checkVAD);
    } catch (e: any) {
      if (xtermRef.current) {
        xtermRef.current.write(`\r\n\x1b[91m[Mic] ${e.name || 'Error'}: ${e.message || 'Failed to access microphone'}\x1b[0m\r\n`);
      }
      setQuestMicActive(false);
    }
  };

  // ─── Voice mode: Web Speech API on desktop, Whisper/Groq mic on Quest ───
  const recognitionRef = useRef<any>(null);
  const isQuestBrowser = typeof navigator !== 'undefined' && /Quest|Oculus|Pacific/i.test(navigator.userAgent);
  const hasWebSpeech = typeof window !== 'undefined' && !isQuestBrowser &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  const startWebSpeech = () => {
    if (!immersiveRef.current) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let lastFinalLength = 0;

    recognition.onresult = (event: any) => {
      if (!immersiveRef.current) return;
      let finalText = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText.length > lastFinalLength) {
        sendPaste(finalText.slice(lastFinalLength));
        lastFinalLength = finalText.length;
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        immersiveRef.current = false;
        setIsImmersiveVoice(false);
        setVoiceStatus('idle');
        return;
      }
      if (immersiveRef.current) setTimeout(startWebSpeech, 500);
    };

    recognition.onend = () => {
      if (immersiveRef.current) setTimeout(startWebSpeech, 100);
      else setVoiceStatus('idle');
    };

    recognition.onstart = () => setVoiceStatus('listening');

    recognitionRef.current = recognition;
    recognition.start();
  };

  const toggleImmersiveVoice = () => {
    if (immersiveRef.current) {
      immersiveRef.current = false;
      setIsImmersiveVoice(false);
      setVoiceStatus('idle');
      if (recognitionRef.current) { try { recognitionRef.current.abort(); } catch {} recognitionRef.current = null; }
    } else if (hasWebSpeech) {
      immersiveRef.current = true;
      setIsImmersiveVoice(true);
      startWebSpeech();
      setTimeout(() => xtermRef.current?.focus(), 100);
    }
  };

  useEffect(() => {
    return () => { immersiveRef.current = false; if (recognitionRef.current) try { recognitionRef.current.abort(); } catch {} };
  }, []);

  // ─── File paste & drag-drop upload ───
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const uploadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const cwd = paneRef.current.cwd || '/';
    const form = new FormData();
    form.append('dir', cwd);
    for (const f of files) form.append('files', f);

    const names = files.map(f => f.name).join(', ');
    setUploadStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
    if (uploadTimeoutRef.current) clearTimeout(uploadTimeoutRef.current);

    try {
      const res = await fetch('/api/files', { method: 'POST', body: form });
      if (res.ok) {
        const data = await res.json();
        setUploadStatus(`Uploaded ${data.files?.join(', ') || names} to ${cwd}`);
        // Write a note into the terminal so the user/agent knows the file is there
        const term = xtermRef.current;
        if (term) {
          term.write(`\r\n\x1b[90m[Uploaded ${data.files?.join(', ') || names} → ${cwd}]\x1b[0m\r\n`);
        }
      } else {
        setUploadStatus('Upload failed');
      }
    } catch {
      setUploadStatus('Upload failed');
    }
    uploadTimeoutRef.current = setTimeout(() => setUploadStatus(null), 4000);
  }, []);
  uploadFilesRef.current = uploadFiles;

  // Listen for paste events with files/images.
  // Must use document-level capture because xterm.js creates an internal <textarea>
  // that receives focus and swallows paste events before they reach the container.
  useEffect(() => {
    const el = termRef.current;
    if (!el) return;

    const handlePaste = (e: ClipboardEvent) => {
      // Only handle pastes when this terminal pane is focused
      if (!el.contains(e.target as Node)) return;

      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        uploadFilesRef.current(files);
      }
      // If no files, let the normal text paste handler (Ctrl+V) handle it
    };

    // Capture phase so we intercept before xterm's textarea handler
    document.addEventListener('paste', handlePaste, true);

    // Drag-and-drop (works directly on the container — xterm doesn't intercept drag events)
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (el && !el.contains(e.relatedTarget as Node)) {
        setIsDragging(false);
      }
    };
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const files: File[] = [];
      if (e.dataTransfer?.files) {
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
          files.push(e.dataTransfer.files[i]);
        }
      }
      if (files.length > 0) uploadFilesRef.current(files);
    };

    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('paste', handlePaste, true);
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('drop', handleDrop);
    };
  }, []);

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
      isMaximized ? 'absolute inset-0 z-40 !rounded-none' : '',
      'border-zinc-700'
    )} style={{ borderColor: `${pane.color}60` }}>
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-xs select-none flex-shrink-0"
        style={{ backgroundColor: `${pane.color}30`, borderBottom: `1px solid ${pane.color}40` }}
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

        <button
          onClick={() => onBrowse?.(pane.cwd)}
          className="text-[10px] text-zinc-500 truncate max-w-[120px] hover:text-amber-400 transition-colors"
          title={`Browse ${pane.cwd}`}
        >
          {pane.cwd.split(/[/\\]/).pop()}
        </button>

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

        {pane.nodeId && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-blue-500/10 text-blue-400 flex items-center gap-0.5">
            <Globe className="w-2.5 h-2.5" />
            remote
          </span>
        )}

        {workspaceCollaboration && pane.agentType !== 'shell' && (
          <button
            onClick={async () => {
              const newVal = !pane.isCollaborating;
              await onUpdate(pane.id, { isCollaborating: newVal } as Partial<PaneData>);
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'collab-toggle', isCollaborating: newVal }));
              }
            }}
            className={`transition-colors ${
              pane.isCollaborating
                ? 'text-indigo-400 hover:text-indigo-300'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
            title={pane.isCollaborating ? 'Collaborating — click to opt out' : 'Not collaborating — click to opt in'}
          >
            <Users className="w-3 h-3" />
          </button>
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
            className="text-zinc-300 hover:text-white"
            title="Pop out to new window"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={() => onToggleMaximize(pane.id)}
          className="text-zinc-300 hover:text-white"
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>

        <button
          onClick={() => {
            if (confirm('Close this terminal?')) onClose(pane.id);
          }}
          className="text-zinc-300 hover:text-red-400"
          title="Close"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Terminal — on Quest, tapping terminal focuses the visible input instead of xterm's hidden textarea */}
      <div
        ref={termRef}
        className="flex-1 relative bg-[#0a0a0a]"
        style={{ minHeight: isMaximized ? (isQuest ? 'calc(100vh - 180px)' : 'calc(100vh - 100px)') : '300px' }}
        onClick={isQuest ? (e) => { e.preventDefault(); } : undefined}
      >

        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-10 bg-indigo-500/10 border-2 border-dashed border-indigo-400 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-2 bg-zinc-900/90 px-4 py-2 rounded-lg text-sm text-indigo-300">
              <Upload className="w-4 h-4" />
              Drop files to upload to {pane.cwd.split(/[/\\]/).pop() || pane.cwd}
            </div>
          </div>
        )}

        {/* Upload status toast */}
        {uploadStatus && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 bg-zinc-800/95 border border-zinc-600 px-3 py-1.5 rounded-lg text-xs text-zinc-300 shadow-lg">
            {uploadStatus}
          </div>
        )}
      </div>

      {/* Quest: input field + virtual keys — prevents xterm hidden textarea layout issues */}
      {isQuest && (
        <div
          className="flex flex-col gap-1 px-2 py-1.5 flex-shrink-0 border-t border-zinc-700"
          style={{ backgroundColor: `${pane.color}15`, borderTopColor: `${pane.color}30` }}
        >
          {/* Text input — readOnly by default to prevent keyboard popup */}
          <div className="flex items-center gap-1">
            <input
              ref={questInputRef}
              type="text"
              value={questInput}
              readOnly={!questKeyboardOpen}
              onChange={(e) => setQuestInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendKey(questInput ? questInput + '\r' : '\r');
                  setQuestInput('');
                  // Close keyboard after sending
                  setQuestKeyboardOpen(false);
                  questInputRef.current?.blur();
                }
              }}
              onBlur={() => setQuestKeyboardOpen(false)}
              placeholder={questMicActive ? 'Listening...' : questKeyboardOpen ? 'Type here...' : 'Use mic or tap ⌨ to type'}
              className={cn(
                'flex-1 text-zinc-200 text-sm px-3 py-2 rounded border focus:outline-none font-mono',
                questKeyboardOpen
                  ? 'bg-zinc-900 border-zinc-400 placeholder:text-zinc-500'
                  : 'bg-zinc-900/50 border-zinc-700 placeholder:text-zinc-600'
              )}
              autoComplete="off"
              autoCorrect="on"
              spellCheck={false}
            />
            <button
              onClick={toggleQuestMic}
              className={cn(
                'p-2 rounded border transition-all',
                questMicActive
                  ? 'bg-red-500 border-red-400 text-white animate-pulse'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-white'
              )}
              title={questMicActive ? 'Stop recording' : 'Start voice dictation'}
            >
              {questMicActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                sendKey(questInput ? questInput + '\r' : '\r');
                setQuestInput('');
              }}
              className="px-3 py-2 text-[11px] font-mono bg-indigo-600 hover:bg-indigo-500 text-white rounded border border-indigo-500 font-medium"
            >
              Send
            </button>
          </div>
          {/* Virtual keys row */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setQuestKeyboardOpen(true);
                setTimeout(() => questInputRef.current?.focus(), 50);
              }}
              className={cn(
                'px-2 py-1 text-[10px] font-mono rounded border',
                questKeyboardOpen
                  ? 'bg-indigo-600 border-indigo-500 text-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border-zinc-700'
              )}
            >
              ⌨
            </button>
            <button
              onClick={() => sendKey('\x1b')}
              className="px-2 py-1 text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded border border-zinc-700"
            >
              Esc
            </button>
            <button
              onClick={() => sendKey('\t')}
              className="px-2 py-1 text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded border border-zinc-700"
            >
              Tab
            </button>
            <button
              onClick={() => sendKey('\x03')}
              className="px-2 py-1 text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded border border-zinc-700"
            >
              Ctrl+C
            </button>
            <button
              onClick={() => sendKey('\x1b[A')}
              className="px-2 py-1 text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded border border-zinc-700"
            >
              ↑
            </button>
            <button
              onClick={() => sendKey('\x1b[B')}
              className="px-2 py-1 text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded border border-zinc-700"
            >
              ↓
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setQuestInput('')}
              className="px-2 py-1 text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded border border-zinc-700"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Desktop: mic button for Web Speech API */}
      {!isQuest && hasWebSpeech && (
        <div
          className="flex items-center justify-end gap-1 px-2 py-1 flex-shrink-0 border-t border-zinc-700/50"
          style={{ backgroundColor: `${pane.color}08` }}
        >
          {isImmersiveVoice && (
            <span className="text-[10px] text-green-400 animate-pulse mr-1">Listening...</span>
          )}
          <button
            onClick={toggleImmersiveVoice}
            className={cn(
              'p-1 rounded border transition-all',
              isImmersiveVoice
                ? 'bg-green-900/50 border-green-500 text-green-400 hover:bg-red-900/50 hover:border-red-600 hover:text-red-400 shadow-[0_0_8px_rgba(34,197,94,0.3)]'
                : 'bg-zinc-800/50 border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'
            )}
            title={isImmersiveVoice ? 'Stop voice mode' : 'Start voice dictation'}
          >
            {isImmersiveVoice ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
    </div>
  );
}
