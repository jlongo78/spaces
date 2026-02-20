'use client';

import { useState, useEffect, useRef } from 'react';
import { Folder, FolderOpen, ChevronRight, ChevronUp, Loader2, HardDrive, X } from 'lucide-react';

interface FolderPickerProps {
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

const DRIVES = ['C:\\', 'D:\\', 'E:\\', 'F:\\'];

export function FolderPicker({ value, onChange }: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState(value || '');
  const [data, setData] = useState<FolderData | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fetch folder listing
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const target = browsePath || '';
    fetch(`/api/folders?path=${encodeURIComponent(target)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, browsePath]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (folderPath: string) => {
    onChange(folderPath);
    setOpen(false);
  };

  const navigate = (folderPath: string) => {
    setBrowsePath(folderPath);
  };

  // Split current path into breadcrumb segments
  const segments = data?.current
    ? data.current.split(/[/\\]/).filter(Boolean)
    : [];

  return (
    <div ref={ref} className="relative">
      {/* Input with browse button */}
      <div className="flex items-center gap-0">
        <input
          type="text"
          placeholder="Working directory"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => { if (!open) { setBrowsePath(value); setOpen(true); } }}
          className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-l-md focus:outline-none focus:border-indigo-500 text-white font-mono"
        />
        <button
          type="button"
          onClick={() => { setBrowsePath(value); setOpen(!open); }}
          className="px-3 py-2 text-sm bg-zinc-700 border border-zinc-700 border-l-0 rounded-r-md hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors"
          title="Browse folders"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      </div>

      {/* Dropdown browser */}
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-xl overflow-hidden">
          {/* Breadcrumb */}
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-zinc-700/50 overflow-x-auto text-[11px] flex-nowrap">
            <button
              onClick={() => navigate('')}
              className="text-zinc-400 hover:text-white flex-shrink-0 p-0.5"
              title="Drives"
            >
              <HardDrive className="w-3 h-3" />
            </button>
            {segments.map((seg, i) => {
              const fullPath = segments.slice(0, i + 1).join('\\');
              // Re-add drive colon for Windows (e.g., "C" -> "C:")
              const resolvedPath = i === 0 && seg.length === 1 ? seg + ':\\' : fullPath;
              return (
                <span key={i} className="flex items-center gap-0.5 flex-shrink-0">
                  <ChevronRight className="w-2.5 h-2.5 text-zinc-600" />
                  <button
                    onClick={() => navigate(resolvedPath)}
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
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
              </div>
            ) : data?.error ? (
              <div className="py-4 px-3 text-xs text-red-400 text-center">{data.error}</div>
            ) : !data?.current || data.current === '' ? (
              // Show drive letters
              <div>
                {DRIVES.map(drive => (
                  <button
                    key={drive}
                    onClick={() => navigate(drive)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-white hover:bg-zinc-700 transition-colors"
                  >
                    <HardDrive className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="font-mono">{drive}</span>
                  </button>
                ))}
              </div>
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
                    {data!.current.split(/[/\\]/).pop()}
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
