'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { TerminalPane } from '@/components/terminal/terminal-pane';
import type { PaneData } from '@/lib/db/queries';

const SAVE_INTERVAL = 2000;

export default function PopoutPanePage({ params }: { params: Promise<{ id: string }> }) {
  const [pane, setPane] = useState<PaneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paneId, setPaneId] = useState<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  // When true, the window is closing because the workspace was closed/switched,
  // so we keep isPopout=true in the DB for restore next time.
  const workspaceCloseRef = useRef(false);

  // Resolve params
  useEffect(() => {
    params.then(p => setPaneId(p.id));
  }, [params]);

  // Load pane data
  useEffect(() => {
    if (!paneId) return;
    fetch(`/api/panes/${paneId}`)
      .then(r => r.json())
      .then(data => { setPane(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [paneId]);

  // Set up BroadcastChannel for cross-window communication
  useEffect(() => {
    if (!paneId) return;
    const channel = new BroadcastChannel('claudesk-panes');
    channelRef.current = channel;

    // Notify main window we're open
    channel.postMessage({ type: 'popout-opened', paneId });

    // Mark pane as popped out in DB
    fetch(`/api/panes/${paneId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isPopout: true,
        winX: window.screenX,
        winY: window.screenY,
        winWidth: window.innerWidth,
        winHeight: window.innerHeight,
      }),
    });

    // Listen for close command from main window (workspace switch/close)
    channel.onmessage = (event) => {
      if (event.data.type === 'close-popouts') {
        // Flag so beforeunload keeps isPopout=true for restore
        workspaceCloseRef.current = true;
        // Save final position, keep isPopout=true so it restores next time
        navigator.sendBeacon(
          `/api/panes/${paneId}`,
          new Blob([JSON.stringify({
            isPopout: true,
            winX: window.screenX,
            winY: window.screenY,
            winWidth: window.innerWidth,
            winHeight: window.innerHeight,
          })], { type: 'application/json' })
        );
        window.close();
      }
    };

    return () => {
      channel.close();
    };
  }, [paneId]);

  // Track window position/size changes
  useEffect(() => {
    if (!paneId) return;

    let saveTimer: ReturnType<typeof setTimeout>;
    const savePosition = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        fetch(`/api/panes/${paneId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            winX: window.screenX,
            winY: window.screenY,
            winWidth: window.innerWidth,
            winHeight: window.innerHeight,
          }),
        });
      }, SAVE_INTERVAL);
    };

    window.addEventListener('resize', savePosition);

    // Also save position on move (approximate via interval since there's no move event)
    let lastX = window.screenX;
    let lastY = window.screenY;
    const moveInterval = setInterval(() => {
      if (window.screenX !== lastX || window.screenY !== lastY) {
        lastX = window.screenX;
        lastY = window.screenY;
        savePosition();
      }
    }, 1000);

    return () => {
      window.removeEventListener('resize', savePosition);
      clearInterval(moveInterval);
      clearTimeout(saveTimer);
    };
  }, [paneId]);

  // On window close, notify main window
  useEffect(() => {
    if (!paneId) return;

    const handleUnload = () => {
      if (workspaceCloseRef.current) {
        // Workspace-triggered close: position already saved with isPopout=true
        // Just notify main window the popout is gone (runtime state)
        channelRef.current?.postMessage({ type: 'popout-closed', paneId });
        return;
      }
      // Manual close by user: mark isPopout=false so it doesn't auto-restore
      navigator.sendBeacon(
        `/api/panes/${paneId}`,
        new Blob([JSON.stringify({
          isPopout: false,
          winX: window.screenX,
          winY: window.screenY,
          winWidth: window.innerWidth,
          winHeight: window.innerHeight,
        })], { type: 'application/json' })
      );
      channelRef.current?.postMessage({ type: 'popout-closed', paneId });
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [paneId]);

  // Set window title
  useEffect(() => {
    if (pane) {
      document.title = `${pane.title} - Spaces`;
    }
  }, [pane?.title]);

  const handleClose = useCallback(async (id: string) => {
    // User explicitly closed via the X button in the terminal pane header
    await fetch(`/api/panes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPopout: false }),
    });
    channelRef.current?.postMessage({ type: 'popout-closed', paneId: id });
    // Set flag so beforeunload doesn't double-write isPopout: false
    workspaceCloseRef.current = true;
    window.close();
  }, []);

  const handleUpdate = useCallback(async (id: string, data: Partial<PaneData>) => {
    await fetch(`/api/panes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setPane(prev => prev ? { ...prev, ...data } : null);
    // Broadcast updates to main window
    channelRef.current?.postMessage({ type: 'pane-updated', paneId: id, data });
  }, []);

  if (loading || !pane) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-zinc-950">
      <TerminalPane
        pane={pane}
        onClose={handleClose}
        onUpdate={handleUpdate}
        isMaximized={true}
        onToggleMaximize={() => {}}
      />
    </div>
  );
}
