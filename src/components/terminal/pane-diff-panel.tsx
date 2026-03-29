'use client';

import { useState, useEffect } from 'react';
import { Loader2, RotateCcw, Copy, X, Check } from 'lucide-react';
import { api } from '@/lib/api';

interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

interface DiffData {
  baselineSha: string;
  currentSha: string;
  files: DiffFile[];
  diff: string;
  untracked: string[];
  truncated?: boolean;
}

export function PaneDiffPanel({ paneId, onClose }: { paneId: string; onClose: () => void }) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const fetchDiff = () => {
    setLoading(true);
    setError(null);
    fetch(api(`/api/panes/${paneId}/diff`))
      .then(r => r.ok ? r.json() : r.json().then(e => { throw new Error(e.error); }))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { fetchDiff(); }, [paneId]);

  const resetBaseline = async () => {
    await fetch(api(`/api/panes/${paneId}/diff`), { method: 'POST' });
    fetchDiff();
  };

  const copyDiff = () => {
    if (data?.diff) {
      navigator.clipboard.writeText(data.diff);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const statusIcon = (status: string) => {
    if (status === 'added') return <span className="text-green-400 text-[10px]">A</span>;
    if (status === 'deleted') return <span className="text-red-400 text-[10px]">D</span>;
    if (status === 'renamed') return <span className="text-blue-400 text-[10px]">R</span>;
    return <span className="text-amber-400 text-[10px]">M</span>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 bg-zinc-900 border-t border-zinc-700">
        <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-t border-zinc-700 text-xs">
        <span className="text-red-400">{error}</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="w-3 h-3" /></button>
      </div>
    );
  }

  if (!data || (data.files.length === 0 && data.untracked.length === 0)) {
    return (
      <div className="flex items-center justify-between px-3 py-2 bg-zinc-900 border-t border-zinc-700 text-xs">
        <span className="text-zinc-500">No changes since baseline</span>
        <div className="flex gap-2">
          <button onClick={resetBaseline} className="text-zinc-500 hover:text-white" title="Reset baseline">
            <RotateCcw className="w-3 h-3" />
          </button>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X className="w-3 h-3" /></button>
        </div>
      </div>
    );
  }

  // Parse diff into lines with coloring
  const diffLines = data.diff.split('\n').map((line, i) => {
    let cls = 'text-zinc-400';
    let bg = '';
    if (line.startsWith('+') && !line.startsWith('+++')) { cls = 'text-green-400'; bg = 'bg-green-500/10'; }
    else if (line.startsWith('-') && !line.startsWith('---')) { cls = 'text-red-400'; bg = 'bg-red-500/10'; }
    else if (line.startsWith('@@')) { cls = 'text-cyan-400'; bg = 'bg-cyan-500/5'; }
    else if (line.startsWith('diff ')) { cls = 'text-zinc-300 font-bold'; }
    return { line, cls, bg, idx: i };
  });

  // Filter to selected file if any
  const filteredLines = selectedFile
    ? diffLines.filter((_, i) => {
        // Find the diff header for the selected file and show until next diff header
        let inFile = false;
        for (let j = 0; j <= i; j++) {
          if (diffLines[j].line.startsWith('diff ') && diffLines[j].line.includes(selectedFile)) inFile = true;
          else if (diffLines[j].line.startsWith('diff ') && j > 0) inFile = false;
        }
        return inFile;
      })
    : diffLines;

  const allFiles = [
    ...data.files,
    ...data.untracked.map(p => ({ path: p, status: 'added', additions: 0, deletions: 0 })),
  ];

  return (
    <div className="flex flex-col bg-zinc-900 border-t border-zinc-700" style={{ height: '40%', minHeight: 150 }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 text-xs flex-shrink-0">
        <div className="flex items-center gap-2 text-zinc-500">
          <span>{allFiles.length} file{allFiles.length !== 1 ? 's' : ''} changed</span>
          <span className="text-zinc-700">|</span>
          <span className="font-mono text-[10px]">{data.baselineSha.slice(0, 7)}..{data.currentSha.slice(0, 7)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={resetBaseline} className="px-2 py-0.5 text-[10px] text-zinc-400 hover:text-white bg-zinc-800 rounded border border-zinc-700" title="Mark as reviewed">
            Reset Baseline
          </button>
          <button onClick={copyDiff} className="text-zinc-500 hover:text-white" title="Copy diff">
            {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
          </button>
          <button onClick={onClose} className="text-zinc-500 hover:text-white" title="Close">
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* File list */}
        <div className="w-48 flex-shrink-0 border-r border-zinc-800 overflow-y-auto">
          <button
            onClick={() => setSelectedFile(null)}
            className={`w-full text-left px-2 py-1 text-[10px] ${!selectedFile ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-400 hover:bg-zinc-800/50'}`}
          >
            All files
          </button>
          {allFiles.map(f => (
            <button
              key={f.path}
              onClick={() => setSelectedFile(f.path)}
              className={`w-full text-left px-2 py-1 text-[10px] flex items-center gap-1.5 ${selectedFile === f.path ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-400 hover:bg-zinc-800/50'}`}
            >
              {statusIcon(f.status)}
              <span className="truncate">{f.path.split('/').pop()}</span>
            </button>
          ))}
        </div>

        {/* Diff view */}
        <div className="flex-1 overflow-auto font-mono text-[11px] leading-[18px]">
          {filteredLines.map(({ line, cls, bg, idx }) => (
            <div key={idx} className={`px-3 ${bg} ${cls} whitespace-pre`}>
              {line || '\u00A0'}
            </div>
          ))}
          {data.truncated && (
            <div className="px-3 py-2 text-amber-400 text-[10px]">Diff truncated at 500KB</div>
          )}
        </div>
      </div>
    </div>
  );
}
