'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';

interface UpdateInfo {
  available: boolean;
  current?: string;
  latest?: string;
  name?: string;
  npm?: { latest: string; available: boolean };
  github?: { latest: string; prerelease: boolean; url: string; available: boolean };
  addons?: Record<string, { installed: boolean; behind: boolean; commitsBehind: number }>;
}

export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const check = () => {
      fetch(api('/api/updates'))
        .then(r => r.json())
        .then((d: UpdateInfo) => {
          // Show if npm update, github update, or any addon behind
          const hasAddonUpdates = d.addons && Object.values(d.addons).some(a => a.behind);
          if (d.available || hasAddonUpdates) setInfo(d);
        })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 4 * 3600_000);
    return () => clearInterval(interval);
  }, []);

  if (!info || dismissed) return null;

  const addonUpdates = info.addons
    ? Object.entries(info.addons).filter(([, a]) => a.behind)
    : [];

  // Nothing to show
  if (!info.available && addonUpdates.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-indigo-500/10 border-b border-indigo-500/20 text-xs shrink-0">
      <div className="flex items-center gap-4 flex-wrap">
        {/* npm update */}
        {info.npm?.available && (
          <span className="text-indigo-300">
            <span className="font-mono">{info.current}</span> → <span className="font-mono font-medium text-indigo-200">{info.npm.latest}</span>
            <code className="ml-2 text-[10px] text-indigo-400/70 bg-indigo-500/10 px-1.5 py-0.5 rounded">
              npm i -g {info.name}
            </code>
          </span>
        )}

        {/* GitHub pre-release / newer release */}
        {info.github?.available && (!info.npm?.available || info.github.latest > (info.npm?.latest || '')) && (
          <span className="text-cyan-300">
            {info.github.prerelease ? 'Pre-release' : 'Release'}: <span className="font-mono font-medium">{info.github.latest}</span>
            {info.github.url && (
              <a
                href={info.github.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1.5 text-[10px] text-cyan-400/70 hover:text-cyan-300 underline"
              >
                view
              </a>
            )}
          </span>
        )}

        {/* Addon updates */}
        {addonUpdates.map(([key, addon]) => (
          <span key={key} className="text-amber-300">
            @spaces/{key}: {addon.commitsBehind} commit{addon.commitsBehind !== 1 ? 's' : ''} behind
            <code className="ml-1.5 text-[10px] text-amber-400/70 bg-amber-500/10 px-1.5 py-0.5 rounded">
              spaces upgrade {key}
            </code>
          </span>
        ))}
      </div>

      <button onClick={() => setDismissed(true)} className="text-indigo-500/50 hover:text-indigo-300 ml-auto shrink-0">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
