'use client';

import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { MarketplaceCard } from './marketplace-card';
import { ImportDialog } from './import-dialog';

interface PackEntry {
  filename: string;
  manifest: any;
}

interface BrowseResponse {
  packs?: PackEntry[];
  directory?: string;
}

export function MarketplaceTab() {
  const [packs, setPacks] = useState<PackEntry[]>([]);
  const [directory, setDirectory] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [importTarget, setImportTarget] = useState<PackEntry | null>(null);

  const fetchPacks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(api('/api/cortex/marketplace/browse'));
      if (res.ok) {
        const data: BrowseResponse = await res.json();
        setPacks(data.packs ?? []);
        if (data.directory) setDirectory(data.directory);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPacks();
  }, [fetchPacks]);

  const handleImportClick = (filename: string, manifest: any) => {
    setImportTarget({ filename, manifest });
  };

  const handleImportComplete = () => {
    setImportTarget(null);
    fetchPacks();
  };

  const hasDomainContext =
    importTarget?.manifest?.marketplace?.domain_context != null ||
    importTarget?.manifest?.domain_context != null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-white/5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">Marketplace</h2>
          {directory && (
            <p className="text-[11px] text-gray-600 font-mono mt-0.5 truncate">{directory}</p>
          )}
        </div>
        <button
          onClick={fetchPacks}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && packs.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-12">Loading...</p>
        )}

        {!loading && packs.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-gray-600">
            <FolderOpen className="w-8 h-8" />
            <p className="text-sm">No .cortexpack files found</p>
          </div>
        )}

        {packs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {packs.map(pack => (
              <MarketplaceCard
                key={pack.filename}
                filename={pack.filename}
                manifest={pack.manifest}
                onImport={handleImportClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Import dialog */}
      {importTarget && (
        <ImportDialog
          filename={importTarget.filename}
          hasDomainContext={hasDomainContext}
          onClose={() => setImportTarget(null)}
          onComplete={handleImportComplete}
        />
      )}
    </div>
  );
}
