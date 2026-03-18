'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder, File, FileText, FileCode, FileJson, Image,
  ChevronRight, ChevronDown, X, ArrowUp, ExternalLink, ArrowLeftToLine,
} from 'lucide-react';
import { api } from '@/lib/api';

interface FileItem {
  name: string;
  path: string;
  isDir: boolean;
  ext: string | null;
}

interface FileContent {
  name: string;
  path: string;
  content?: string;
  lines?: number;
  truncated?: boolean;
  size: number;
  ext: string;
  binary?: boolean;
  image?: boolean;
  pdf?: boolean;
  rawUrl?: string;
  tooLarge?: boolean;
  error?: string;
}

const CHANNEL_NAME = 'spaces-file-viewer';
const STORAGE_KEY = 'spaces-file-viewer-state';

interface PopupState {
  x: number;
  y: number;
  w: number;
  h: number;
  wasPoppedOut: boolean;
  lastFilePath?: string;
}

function loadPopupState(): PopupState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return { x: 0, y: 0, w: 800, h: 600, wasPoppedOut: false };
}

function savePopupState(state: Partial<PopupState>) {
  try {
    const current = loadPopupState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch { /* */ }
}

function langClass(ext: string | null): string {
  if (!ext) return '';
  const map: Record<string, string> = {
    '.ts': 'text-blue-300', '.tsx': 'text-blue-300',
    '.js': 'text-yellow-300', '.jsx': 'text-yellow-300',
    '.json': 'text-green-300', '.md': 'text-zinc-300',
    '.css': 'text-pink-300', '.scss': 'text-pink-300',
    '.html': 'text-orange-300', '.xml': 'text-orange-300',
    '.py': 'text-emerald-300', '.rb': 'text-red-300',
    '.go': 'text-cyan-300', '.rs': 'text-orange-300',
    '.sh': 'text-green-300', '.bash': 'text-green-300',
    '.yml': 'text-purple-300', '.yaml': 'text-purple-300',
    '.sql': 'text-blue-200', '.graphql': 'text-pink-200',
  };
  return map[ext] || 'text-zinc-300';
}

function FileIcon({ item }: { item: FileItem }) {
  if (item.isDir) return <Folder className="w-3.5 h-3.5 text-amber-500/70 flex-shrink-0" />;
  const ext = item.ext || '';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext))
    return <Image className="w-3.5 h-3.5 text-emerald-400/70 flex-shrink-0" />;
  if (['.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs'].includes(ext))
    return <FileCode className="w-3.5 h-3.5 text-blue-400/70 flex-shrink-0" />;
  if (ext === '.json') return <FileJson className="w-3.5 h-3.5 text-green-400/70 flex-shrink-0" />;
  if (['.md', '.txt', '.yml', '.yaml'].includes(ext))
    return <FileText className="w-3.5 h-3.5 text-zinc-400/70 flex-shrink-0" />;
  return <File className="w-3.5 h-3.5 text-zinc-500/70 flex-shrink-0" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function writePopupShell(popup: Window, fileName: string) {
  popup.document.write(`<!DOCTYPE html><html><head><title>${fileName} — Spaces</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #0a0a0a; color: #e4e4e7; font-family: system-ui, sans-serif; overflow: auto; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #27272a; background: #09090b; position: sticky; top: 0; z-index: 10; }
  .header .name { font-size: 12px; font-family: 'Cascadia Code', 'Fira Code', monospace; opacity: 0.7; }
  .header .meta { font-size: 10px; color: #666; }
  .header button { background: none; border: 1px solid #333; color: #888; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
  .header button:hover { color: #fff; border-color: #555; }
  .content { padding: 0; }
  table { border-collapse: collapse; font-size: 12px; line-height: 18px; font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; width: 100%; }
  td.ln { text-align: right; padding: 0 12px; color: #444; user-select: none; white-space: nowrap; }
  td.code { padding: 0 12px; white-space: pre; }
  tr:hover { background: rgba(255,255,255,0.02); }
  .img-wrap { display: flex; align-items: center; justify-content: center; min-height: calc(100vh - 40px); padding: 16px; }
  .img-wrap img { max-width: 100%; max-height: calc(100vh - 56px); object-fit: contain; }
  .center { display: flex; align-items: center; justify-content: center; height: calc(100vh - 40px); color: #666; font-size: 13px; }
  iframe { width: 100%; height: calc(100vh - 40px); border: none; }
</style></head><body>
<div class="header">
  <div><span class="name" id="fname">${fileName}</span> <span class="meta" id="fmeta"></span></div>
  <button id="popin">Pop back in</button>
</div>
<div class="content" id="viewer"></div>
<script>
  const channel = new BroadcastChannel('${CHANNEL_NAME}');
  const storageKey = '${STORAGE_KEY}';

  document.getElementById('popin').onclick = () => {
    savePos();
    channel.postMessage({ type: 'pop-in' });
    window.close();
  };

  function savePos() {
    try {
      const state = JSON.parse(localStorage.getItem(storageKey) || '{}');
      state.x = window.screenX;
      state.y = window.screenY;
      state.w = window.outerWidth;
      state.h = window.outerHeight;
      state.wasPoppedOut = false;
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {}
  }

  window.addEventListener('beforeunload', () => {
    savePos();
    channel.postMessage({ type: 'pop-in' });
  });

  function renderFile(file) {
    document.getElementById('fname').textContent = file.name;
    document.title = file.name + ' — Spaces';
    const meta = document.getElementById('fmeta');
    meta.textContent = file.lines ? file.lines + ' lines' : '';
    const el = document.getElementById('viewer');

    if (file.error) {
      el.innerHTML = '<div class="center">' + file.error + '</div>';
    } else if (file.image && file.rawUrl) {
      el.innerHTML = '<div class="img-wrap"><img src="' + file.rawUrl + '" /></div>';
    } else if (file.pdf && file.rawUrl) {
      el.innerHTML = '<iframe src="' + file.rawUrl + '"></iframe>';
    } else if (file.binary) {
      el.innerHTML = '<div class="center">Binary file (' + file.ext + ')</div>';
    } else if (file.content !== undefined) {
      const lines = file.content.split('\\n');
      let html = '<table>';
      for (let i = 0; i < lines.length; i++) {
        const safe = lines[i].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        html += '<tr><td class="ln">' + (i+1) + '</td><td class="code">' + (safe || ' ') + '</td></tr>';
      }
      html += '</table>';
      el.innerHTML = html;
    } else {
      el.innerHTML = '<div class="center">Cannot preview this file</div>';
    }
  }

  channel.onmessage = (e) => {
    if (e.data?.type === 'file-update') renderFile(e.data.file);
    if (e.data?.type === 'close-popup') { savePos(); window.close(); }
  };
</script></body></html>`);
  popup.document.close();
}

interface Props {
  onClose: () => void;
  navigateTo?: string | null;
}

export function FileExplorer({ onClose, navigateTo }: Props) {
  const [devDirs, setDevDirs] = useState<string[]>([]);
  const [rootPath, setRootPath] = useState<string>('');
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<FileItem[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [openFile, setOpenFile] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [poppedOut, setPoppedOut] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Set up broadcast channel
  useEffect(() => {
    mountedRef.current = true;
    channelRef.current = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current.onmessage = (e) => {
      if (e.data?.type === 'pop-in') {
        savePopupState({ wasPoppedOut: false });
        setPoppedOut(false);
        popupRef.current = null;
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    };
    return () => {
      mountedRef.current = false;
      channelRef.current?.close();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Fetch dev directories on mount
  useEffect(() => {
    fetch(api('/api/config'))
      .then(r => r.json())
      .then(data => {
        const dirs: string[] = data.devDirectories || [];
        setDevDirs(dirs);
        if (dirs.length > 0 && !rootPath) {
          setRootPath(dirs[0]);
          setCurrentPath(dirs[0]);
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchRoot = (dir: string) => {
    setRootPath(dir);
    setCurrentPath(dir);
    setExpandedDirs(new Set());
    setOpenFile(null);
  };

  // Navigate to a specific directory from outside (e.g. pane CWD click)
  useEffect(() => {
    if (!navigateTo) return;
    // Find the dev dir that contains this path, or use the path as both root and current
    const matchingRoot = devDirs.find(d =>
      navigateTo === d || navigateTo.startsWith(d + '/') || navigateTo.startsWith(d + '\\')
    );
    if (matchingRoot) {
      setRootPath(matchingRoot);
      setCurrentPath(navigateTo);
    } else {
      // Not under a dev dir — use the path itself as root
      setRootPath(navigateTo);
      setCurrentPath(navigateTo);
    }
    setExpandedDirs(new Set());
  }, [navigateTo, devDirs]);

  // When file changes and viewer is popped out, push update to popup
  useEffect(() => {
    if (poppedOut && openFile && channelRef.current) {
      try { channelRef.current.postMessage({ type: 'file-update', file: openFile }); } catch { /* closed */ }
    }
  }, [openFile, poppedOut]);

  // On mount: if previously popped out, restore the last file and re-pop
  const didAutoPopRef = useRef(false);
  useEffect(() => {
    didAutoPopRef.current = false;
    const state = loadPopupState();
    if (state.wasPoppedOut && state.lastFilePath) {
      // Fetch the last file and auto-popout
      fetch(api(`/api/files?file=${encodeURIComponent(state.lastFilePath)}`))
        .then(r => r.json())
        .then(data => {
          if (data && !data.error) {
            setOpenFile(data);
            if (!didAutoPopRef.current) {
              didAutoPopRef.current = true;
              // Small delay to let state settle before opening popup
              setTimeout(() => openPopup(data), 50);
            }
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close popup when this component unmounts (panel hidden)
  useEffect(() => {
    return () => {
      if (popupRef.current && !popupRef.current.closed) {
        savePopupState({ wasPoppedOut: true });
        try { popupRef.current.close(); } catch { /* cross-origin or already closed */ }
      }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadDir = useCallback(async (dirPath: string) => {
    try {
      const res = await fetch(api(`/api/files?path=${encodeURIComponent(dirPath)}`));
      const data = await res.json();
      return { items: data.items || [], parent: data.parent || null };
    } catch {
      return { items: [], parent: null };
    }
  }, []);

  useEffect(() => {
    if (!currentPath) return;
    setLoading(true);
    loadDir(currentPath).then(data => {
      setItems(data.items);
      setParentPath(data.parent);
      setLoading(false);
    });
  }, [currentPath, loadDir]);

  const handleClick = async (item: FileItem) => {
    if (item.isDir) {
      setExpandedDirs(prev => {
        const next = new Set(prev);
        if (next.has(item.path)) next.delete(item.path);
        else next.add(item.path);
        return next;
      });
    } else {
      try {
        const res = await fetch(api(`/api/files?file=${encodeURIComponent(item.path)}`));
        const data = await res.json();
        setOpenFile(data);
        savePopupState({ lastFilePath: item.path });
      } catch {
        setOpenFile({ name: item.name, path: item.path, size: 0, ext: item.ext || '', error: 'Failed to load' });
      }
    }
  };

  const startPoll = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (popupRef.current?.closed) {
        savePopupState({ wasPoppedOut: false });
        if (mountedRef.current) setPoppedOut(false);
        popupRef.current = null;
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    }, 500);
  };

  const openPopup = (file: FileContent) => {
    const saved = loadPopupState();
    const w = saved.w || 800;
    const h = saved.h || 600;
    const left = saved.x || (window.screenX + (window.outerWidth - w) / 2);
    const top = saved.y || (window.screenY + (window.outerHeight - h) / 2);

    const popup = window.open('about:blank', 'spaces-file-viewer', `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) return;

    popupRef.current = popup;
    setPoppedOut(true);
    savePopupState({ wasPoppedOut: true });

    writePopupShell(popup, file.name);

    setTimeout(() => {
      channelRef.current?.postMessage({ type: 'file-update', file });
    }, 100);

    startPoll();
  };

  const popoutViewer = () => {
    if (!openFile) return;
    openPopup(openFile);
  };

  const popIn = () => {
    savePopupState({ wasPoppedOut: false });
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close();
    }
    popupRef.current = null;
    setPoppedOut(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const navigateUp = () => {
    if (parentPath && currentPath !== rootPath) {
      setCurrentPath(parentPath);
    }
  };

  const relativePath = rootPath ? currentPath.replace(rootPath, '').replace(/^[/\\]/, '') : '';
  const crumbs = relativePath ? relativePath.split(/[/\\]/) : [];
  const showInlineViewer = openFile && !poppedOut;
  const canGoUp = parentPath && currentPath !== rootPath;

  if (!rootPath) {
    return (
      <div className="h-full flex flex-col bg-zinc-950 border-r border-zinc-800">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50 flex-shrink-0">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Files</span>
          <button onClick={onClose} className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-3 text-xs text-zinc-500">
          {devDirs.length === 0
            ? 'No development directories configured. Add them in Settings.'
            : 'Loading...'}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950 border-r border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/50 flex-shrink-0">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Files</span>
        <button onClick={onClose} className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Root selector (when multiple dev dirs) */}
      {devDirs.length > 1 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800/30 flex-shrink-0 overflow-x-auto">
          {devDirs.map(dir => {
            const name = dir.split(/[/\\]/).pop() || dir;
            const isActive = dir === rootPath;
            return (
              <button
                key={dir}
                onClick={() => switchRoot(dir)}
                className={`px-2 py-0.5 text-[10px] rounded transition-colors flex-shrink-0 ${
                  isActive
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
                }`}
                title={dir}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-800/30 overflow-x-auto text-[10px] flex-shrink-0">
        {canGoUp && (
          <button onClick={navigateUp} className="text-zinc-500 hover:text-zinc-300 flex-shrink-0">
            <ArrowUp className="w-3 h-3" />
          </button>
        )}
        <button
          onClick={() => setCurrentPath(rootPath)}
          className="text-zinc-500 hover:text-zinc-300 truncate flex-shrink-0"
        >
          {rootPath.split(/[/\\]/).pop()}
        </button>
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1 flex-shrink-0">
            <span className="text-zinc-700">/</span>
            <button
              onClick={() => {
                const target = rootPath + '/' + crumbs.slice(0, i + 1).join('/');
                setCurrentPath(target);
              }}
              className="text-zinc-500 hover:text-zinc-300"
            >
              {crumb}
            </button>
          </span>
        ))}
      </div>

      {/* Popped-out indicator */}
      {poppedOut && openFile && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/30 bg-zinc-900/50 flex-shrink-0">
          <span className="text-[10px] text-zinc-500">Viewing:</span>
          <span className="text-[10px] text-zinc-400 font-mono truncate flex-1">{openFile.name}</span>
          <button
            onClick={popIn}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Pop back into panel"
          >
            <ArrowLeftToLine className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Tree + Viewer */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className={`overflow-y-auto ${showInlineViewer ? 'max-h-[40%] border-b border-zinc-800/30' : 'flex-1'}`}>
          {loading ? (
            <div className="p-3 text-xs text-zinc-600">Loading...</div>
          ) : items.length === 0 ? (
            <div className="p-3 text-xs text-zinc-600">Empty directory</div>
          ) : (
            <div className="py-1">
              {items.map(item => (
                <TreeItem
                  key={item.path}
                  item={item}
                  depth={0}
                  expanded={expandedDirs.has(item.path)}
                  expandedDirs={expandedDirs}
                  onClick={handleClick}
                  loadDir={loadDir}
                  activeFile={openFile?.path}
                />
              ))}
            </div>
          )}
        </div>

        {showInlineViewer && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/30 flex-shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`text-xs font-mono truncate ${langClass(openFile.ext)}`}>{openFile.name}</span>
                <span className="text-[9px] text-zinc-600">
                  {openFile.lines ? `${openFile.lines} lines` : formatSize(openFile.size)}
                </span>
                {openFile.truncated && <span className="text-[9px] text-amber-500">(truncated)</span>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={popoutViewer}
                  className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                  title="Open in new window"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setOpenFile(null)}
                  className="p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <FileViewerContent file={openFile} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FileViewerContent({ file }: { file: FileContent }) {
  if (file.error) return <div className="p-3 text-xs text-red-400">{file.error}</div>;
  if (file.image && file.rawUrl) return (
    <div className="flex items-center justify-center p-4 min-h-[200px]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={api(file.rawUrl)} alt={file.name} className="max-w-full max-h-[60vh] object-contain rounded" />
    </div>
  );
  if (file.image && file.tooLarge) return <div className="p-3 text-xs text-zinc-500">Image too large ({formatSize(file.size)})</div>;
  if (file.pdf && file.rawUrl) return <iframe src={api(file.rawUrl)} className="w-full h-full border-none" title={file.name} />;
  if (file.binary) return <div className="p-3 text-xs text-zinc-500">Binary file ({file.ext}, {formatSize(file.size)})</div>;
  if (file.content !== undefined) return (
    <pre className="text-[11px] leading-4 font-mono p-0 m-0">
      <table className="border-collapse w-full">
        <tbody>
          {file.content.split('\n').map((line, i) => (
            <tr key={i} className="hover:bg-zinc-800/30">
              <td className="text-right pr-3 pl-3 text-zinc-700 select-none w-[1%] whitespace-nowrap">{i + 1}</td>
              <td className={`pr-3 whitespace-pre ${langClass(file.ext)}`}>{line || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </pre>
  );
  return null;
}

function TreeItem({
  item, depth, expanded, expandedDirs, onClick, loadDir, activeFile,
}: {
  item: FileItem;
  depth: number;
  expanded: boolean;
  expandedDirs: Set<string>;
  onClick: (item: FileItem) => void;
  loadDir: (path: string) => Promise<{ items: FileItem[]; parent: string | null }>;
  activeFile?: string;
}) {
  const [children, setChildren] = useState<FileItem[] | null>(null);

  useEffect(() => {
    if (expanded && item.isDir && !children) {
      loadDir(item.path).then(data => setChildren(data.items));
    }
  }, [expanded, item.isDir, item.path, children, loadDir]);

  const isActive = activeFile === item.path;

  return (
    <>
      <button
        onClick={() => onClick(item)}
        className={`flex items-center gap-1.5 w-full text-left px-2 py-[3px] text-[11px] transition-colors ${
          isActive ? 'bg-indigo-500/10 text-indigo-300' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {item.isDir ? (
          expanded
            ? <ChevronDown className="w-3 h-3 text-zinc-600 flex-shrink-0" />
            : <ChevronRight className="w-3 h-3 text-zinc-600 flex-shrink-0" />
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <FileIcon item={item} />
        <span className="truncate">{item.name}</span>
      </button>
      {expanded && item.isDir && children && children.map(child => (
        <TreeItem
          key={child.path}
          item={child}
          depth={depth + 1}
          expanded={expandedDirs.has(child.path)}
          expandedDirs={expandedDirs}
          onClick={onClick}
          loadDir={loadDir}
          activeFile={activeFile}
        />
      ))}
    </>
  );
}
