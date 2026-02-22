'use client';

import { useState } from 'react';
import { useAddNode } from '@/hooks/use-network';
import { X, Loader2 } from 'lucide-react';

interface NodeAddDialogProps {
  onClose: () => void;
}

export function NodeAddDialog({ onClose }: NodeAddDialogProps) {
  const addNode = useAddNode();
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const handleAdd = async () => {
    setError('');
    try {
      await addNode.mutateAsync({ url, apiKey, name: name || undefined });
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to connect');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-800 w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-base font-semibold">Add Node</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5 block">
              Node URL
            </label>
            <input
              autoFocus
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://my-server.example.com/spaces"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-zinc-400 mt-1">The base URL of the remote Spaces instance</p>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5 block">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="spk_..."
              className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <p className="text-[11px] text-zinc-400 mt-1">Generated on the remote node's Network page</p>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1.5 block">
              Display Name <span className="text-zinc-400">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Auto-detected from remote node"
              className="w-full px-3 py-2 text-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-zinc-200 dark:border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!url.trim() || !apiKey.trim() || addNode.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50"
          >
            {addNode.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
