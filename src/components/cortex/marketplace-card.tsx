'use client';

import { useState } from 'react';
import { Package, ChevronDown, ChevronUp } from 'lucide-react';

interface MarketplaceCardProps {
  filename: string;
  manifest: any;
  onImport: (filename: string, manifest: any) => void;
}

export function MarketplaceCard({ filename, manifest, onImport }: MarketplaceCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  const meta = manifest.marketplace ?? {};
  const name = meta.name || filename;
  const version = manifest.version || meta.version || '0.0.0';
  const author = meta.author || manifest.author || 'Unknown';
  const description = meta.description || manifest.description || '';
  const tags: string[] = meta.tags || manifest.tags || [];
  const license: string = meta.license || manifest.license || '';
  const coverage: number = typeof meta.coverage_score === 'number' ? meta.coverage_score : -1;
  const unitCount: number =
    typeof manifest.unit_count === 'number'
      ? manifest.unit_count
      : Array.isArray(manifest.units)
      ? manifest.units.length
      : 0;
  const preview: string = meta.preview || manifest.preview || '';

  const coverageColor =
    coverage < 0
      ? 'text-gray-500'
      : coverage > 0.7
      ? 'text-green-400'
      : coverage > 0.3
      ? 'text-amber-400'
      : 'text-red-400';

  const coverageLabel =
    coverage < 0 ? 'N/A' : `${Math.round(coverage * 100)}%`;

  return (
    <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] flex flex-col gap-3 hover:border-white/20 transition-colors">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
          <Package className="w-4 h-4 text-purple-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-100 truncate">{name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono shrink-0">
              v{version}
            </span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{author}</p>
        </div>
      </div>

      {/* Description */}
      {description && (
        <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">{description}</p>
      )}

      {/* Tags + license */}
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map(tag => (
          <span
            key={tag}
            className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/5"
          >
            {tag}
          </span>
        ))}
        {license && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium">
            {license}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-[11px]">
        <div className="flex items-center gap-1">
          <span className="text-gray-600">Coverage:</span>
          <span className={`font-semibold tabular-nums ${coverageColor}`}>{coverageLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-gray-600">Units:</span>
          <span className="text-gray-300 font-semibold tabular-nums">{unitCount}</span>
        </div>
      </div>

      {/* Expandable preview */}
      {preview && (
        <div>
          <button
            onClick={() => setPreviewOpen(v => !v)}
            className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            {previewOpen ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
            {previewOpen ? 'Hide preview' : 'Show preview'}
          </button>
          {previewOpen && (
            <pre className="mt-2 text-[10px] text-gray-400 bg-white/[0.03] border border-white/5 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {preview}
            </pre>
          )}
        </div>
      )}

      {/* Import button */}
      <button
        onClick={() => onImport(filename, manifest)}
        className="w-full py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
      >
        Import
      </button>
    </div>
  );
}
