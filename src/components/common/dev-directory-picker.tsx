'use client';

import { useState, useEffect, useRef } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronUp, Loader2, Settings } from 'lucide-react';
import { api } from '@/lib/api';

interface DevDirectoryPickerProps {
  value: string;
  onChange: (path: string) => void;
}

interface FolderEntry {
  name: string;
  path: string;
}

interface FolderData {
  current: string;
  parent: string | null;
  folders: FolderEntry[];
  error?: string;
}

export function DevDirectoryPicker({ value, onChange }: DevDirectoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [devDirs, setDevDirs] = useState<string[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [data, setData] = useState<FolderData | null>(null);
  const [loading, setLoading] = useState(false);
  // 'list' = showing dev dirs, 'browse' = browsing inside one
  const [mode, setMode] = useState<'list' | 'browse'>('list');
  const ref = useRef<HTMLDivElement>(null);

  // Fetch dev directories from config
  useEffect(() => {
    fetch(api('/api/config'))
      .then(r => r.json())
      .then(cfg => {
        const dirs: string[] = cfg.devDirectories || [];
        setDevDirs(dirs);
        setConfigLoaded(true);
      })
      .catch(() => setConfigLoaded(true));
  }, []);

  // Fetch folder listing when browsing
  useEffect(() => {
    if (!open || mode !== 'browse' || !browsePath) return;
    setLoading(true);
    fetch(api(`/api/folders?path=${encodeURIComponent(browsePath)}`))
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, mode, browsePath]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpen = () => {
    if (open) {
      setOpen(false);
      return;
    }
    // If only one dev dir, skip straight to browsing it
    if (devDirs.length === 1) {
      setMode('browse');
      setBrowsePath(devDirs[0]);
    } else {
      setMode('list');
    }
    setOpen(true);
  };

  const enterDir = (dir: string) => {
    setMode('browse');
    setBrowsePath(dir);
  };

  const select = (folderPath: string) => {
    onChange(folderPath);
    setOpen(false);
  };

  const navigate = (folderPath: string) => {
    setBrowsePath(folderPath);
  };

  const backToList = () => {
    setMode('list');
    setData(null);
  };

  // Breadcrumb segments relative to the dev directory root
  const activeRoot = devDirs.find(d => data?.current === d || data?.current?.startsWith(d + '/'));
  const rootName = activeRoot?.split('/').pop() || '';
  const relativePath = activeRoot && data?.current ? data.current.slice(activeRoot.length) : '';
  const segments = relativePath ? relativePath.split('/').filter(Boolean) : [];

  return (
    <div ref={ref} className="relative">
      {/* Input with browse button */}
      <div className="flex items-center gap-0">
        <input
          type="text"
          placeholder="Working directory"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => { if (!open) handleOpen(); }}
          className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-l-md focus:outline-none focus:border-indigo-500 text-white font-mono"
        />
        <button
          type="button"
          onClick={handleOpen}
          className="px-3 py-2 text-sm bg-zinc-700 border border-zinc-700 border-l-0 rounded-r-md hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors"
          title="Browse folders"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-xl overflow-hidden">
          {!configLoaded ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
            </div>
          ) : devDirs.length === 0 && mode === 'list' ? (
            /* No dev directories configured */
            <div className="py-6 px-4 text-center">
              <Settings className="w-5 h-5 text-zinc-500 mx-auto mb-2" />
              <p className="text-xs text-zinc-400 mb-1">No development directories configured</p>
              <p className="text-[11px] text-zinc-500">Add them in Settings to browse project folders here.</p>
            </div>
          ) : mode === 'list' ? (
            /* Dev directory list */
            <div>
              <div className="px-3 py-1.5 border-b border-zinc-700/50 text-[11px] text-zinc-500 font-medium">
                Development Directories
              </div>
              <div className="max-h-[250px] overflow-y-auto">
                {devDirs.map(dir => (
                  <button
                    key={dir}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-700 transition-colors group"
                    onClick={() => enterDir(dir)}
                    onDoubleClick={() => select(dir)}
                    title="Click to browse, double-click to select"
                  >
                    <Folder className="w-3.5 h-3.5 text-amber-500/70" />
                    <span className="font-mono text-white truncate flex-1 text-left">{dir}</span>
                    <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Browsing inside a dev directory */
            <div>
              {/* Breadcrumb */}
              <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-zinc-700/50 overflow-x-auto text-[11px] flex-nowrap">
                {devDirs.length > 1 && (
                  <button
                    onClick={backToList}
                    className="text-zinc-400 hover:text-white flex-shrink-0 p-0.5 mr-0.5"
                    title="Back to dev directories"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => activeRoot && navigate(activeRoot)}
                  className="text-zinc-400 hover:text-white flex-shrink-0"
                >
                  {rootName}
                </button>
                {segments.map((seg, i) => {
                  const fullPath = activeRoot + '/' + segments.slice(0, i + 1).join('/');
                  return (
                    <span key={i} className="flex items-center gap-0.5 flex-shrink-0">
                      <ChevronRight className="w-2.5 h-2.5 text-zinc-600" />
                      <button
                        onClick={() => navigate(fullPath)}
                        className="text-zinc-400 hover:text-white hover:underline"
                      >
                        {seg}
                      </button>
                    </span>
                  );
                })}
              </div>

              {/* Folder list */}
              <div className="max-h-[250px] overflow-y-auto">
                {loading || !data ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                  </div>
                ) : data.error ? (
                  <div className="py-4 px-3 text-xs text-red-400 text-center">{data.error}</div>
                ) : (
                  <>
                    {/* Go up */}
                    {data?.parent && (
                      <button
                        onClick={() => navigate(data.parent!)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 hover:text-white hover:bg-zinc-700/50 transition-colors border-b border-zinc-700/30"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                        <span>..</span>
                      </button>
                    )}

                    {/* Select current directory */}
                    <button
                      onClick={() => select(data!.current)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-indigo-400 hover:bg-indigo-500/10 transition-colors border-b border-zinc-700/30 font-medium"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Select this folder</span>
                      <span className="ml-auto text-[10px] text-zinc-500 font-mono truncate max-w-[200px]">
                        {data!.current.split('/').pop()}
                      </span>
                    </button>

                    {/* Subfolders */}
                    {data?.folders.length === 0 ? (
                      <div className="py-3 px-3 text-[11px] text-zinc-500 text-center">No subfolders</div>
                    ) : (
                      data?.folders.map(f => (
                        <button
                          key={f.path}
                          onClick={() => navigate(f.path)}
                          onDoubleClick={() => select(f.path)}
                          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 transition-colors"
                          title="Click to open, double-click to select"
                        >
                          <Folder className="w-3.5 h-3.5 text-amber-500/70" />
                          <span className="truncate">{f.name}</span>
                        </button>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Close */}
          <div className="border-t border-zinc-700/50 px-2 py-1 flex justify-end">
            <button
              onClick={() => setOpen(false)}
              className="text-[11px] text-zinc-500 hover:text-white px-2 py-0.5"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
