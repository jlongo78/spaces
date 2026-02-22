'use client';

import { useState } from 'react';
import { useNodeIdentity, useUpdateNodeName } from '@/hooks/use-network';
import { NodeList } from '@/components/network/node-list';
import { ApiKeyList } from '@/components/network/api-key-list';
import { Pencil, Check, X, Loader2, Copy } from 'lucide-react';

export default function NetworkPage() {
  const { data: identity, isLoading } = useNodeIdentity();
  const updateName = useUpdateNodeName();

  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [copiedId, setCopiedId] = useState(false);

  const saveName = () => {
    if (nameValue.trim()) {
      updateName.mutate(nameValue.trim());
    }
    setEditing(false);
  };

  const copyNodeId = () => {
    if (identity?.nodeId) {
      navigator.clipboard.writeText(identity.nodeId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Network</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Connect to other Spaces instances and manage API keys
        </p>
      </div>

      {/* This Node */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
          This Node
        </h2>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4">
            <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
            <span className="text-sm text-zinc-400">Loading...</span>
          </div>
        ) : identity ? (
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 w-16">Name</span>
              {editing ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveName();
                      if (e.key === 'Escape') setEditing(false);
                    }}
                    className="px-2 py-0.5 text-sm bg-white dark:bg-zinc-950 border border-indigo-400 rounded focus:outline-none"
                  />
                  <button onClick={saveName} className="text-green-500 hover:text-green-400 p-0.5">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditing(false)} className="text-zinc-400 hover:text-zinc-300 p-0.5">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 group">
                  <span className="text-sm font-medium">{identity.nodeName}</span>
                  <button
                    onClick={() => { setNameValue(identity.nodeName); setEditing(true); }}
                    className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 w-16">Node ID</span>
              <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400">{identity.nodeId}</span>
              <button
                onClick={copyNodeId}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-0.5"
                title="Copy node ID"
              >
                {copiedId ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 w-16">Version</span>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{identity.version}</span>
            </div>
          </div>
        ) : null}
      </section>

      {/* API Keys */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
          API Keys
        </h2>
        <p className="text-xs text-zinc-400 mb-3">
          Share an API key with other nodes so they can connect to this instance.
        </p>
        <ApiKeyList />
      </section>

      {/* Connected Nodes */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
          Connected Nodes
        </h2>
        <p className="text-xs text-zinc-400 mb-3">
          Remote Spaces instances that share sessions and terminals with this node.
        </p>
        <NodeList />
      </section>
    </div>
  );
}
