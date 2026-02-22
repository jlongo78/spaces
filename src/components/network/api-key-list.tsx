'use client';

import { useState } from 'react';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/use-network';
import { Plus, Trash2, Copy, Check, Key, Loader2 } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

export function ApiKeyList() {
  const { data: keys, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState('terminal');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const result = await createKey.mutateAsync({ name: name.trim(), permissions });
    setNewKey(result.rawKey);
    setName('');
    setShowCreate(false);
  };

  const copyKey = () => {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* New key banner */}
      {newKey && (
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
            API key created. Copy it now — it won't be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-white dark:bg-zinc-900 border border-green-200 dark:border-green-800 rounded px-3 py-2 select-all break-all">
              {newKey}
            </code>
            <button
              onClick={copyKey}
              className="flex-shrink-0 p-2 text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900 rounded-md"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="text-xs text-green-600 dark:text-green-400 mt-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Key table */}
      {keys && keys.length > 0 ? (
        <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 dark:bg-zinc-900 text-left text-xs text-zinc-500">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Prefix</th>
                <th className="px-4 py-2 font-medium">Permissions</th>
                <th className="px-4 py-2 font-medium">Last Used</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {keys.map((key) => (
                <tr key={key.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <td className="px-4 py-2.5 font-medium">{key.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-500">{key.keyPrefix}...</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                      {key.permissions}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">
                    {key.lastUsed ? formatRelativeTime(key.lastUsed) : 'Never'}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 text-xs">
                    {formatRelativeTime(key.created)}
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => {
                        if (confirm(`Revoke API key "${key.name}"? Remote nodes using this key will lose access.`)) {
                          revokeKey.mutate(key.id);
                        }
                      }}
                      className="p-1 text-zinc-400 hover:text-red-500 rounded"
                      title="Revoke key"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-8 text-sm text-zinc-500">
          <Key className="w-8 h-8 mx-auto mb-2 text-zinc-300 dark:text-zinc-700" />
          <p>No API keys yet.</p>
          <p className="text-xs mt-1">Create a key so other nodes can connect to this one.</p>
        </div>
      )}

      {/* Create form */}
      {showCreate ? (
        <div className="flex items-end gap-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
          <div className="flex-1">
            <label className="text-xs text-zinc-500 mb-1 block">Key Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="e.g., Team Server"
              className="w-full px-3 py-1.5 text-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Permissions</label>
            <select
              value={permissions}
              onChange={(e) => setPermissions(e.target.value)}
              className="px-3 py-1.5 text-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="read">Read</option>
              <option value="terminal">Terminal</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || createKey.isPending}
            className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-500 disabled:opacity-50"
          >
            Create
          </button>
          <button
            onClick={() => { setShowCreate(false); setName(''); }}
            className="px-3 py-1.5 text-sm border border-zinc-200 dark:border-zinc-700 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-500"
        >
          <Plus className="w-3.5 h-3.5" />
          Create API Key
        </button>
      )}
    </div>
  );
}
