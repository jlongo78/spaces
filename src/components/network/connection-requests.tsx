'use client';

import { useConnectionRequests, useRespondToRequest } from '@/hooks/use-network';
import { Check, X, Loader2, Radio } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

export function ConnectionRequests() {
  const { data, isLoading } = useConnectionRequests();
  const respond = useRespondToRequest();

  const incoming = data?.incoming || [];
  const outgoing = data?.outgoing || [];

  if (isLoading || (incoming.length === 0 && outgoing.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Incoming requests */}
      {incoming.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Incoming Requests
          </h3>
          <div className="space-y-2">
            {incoming.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Radio className="w-4 h-4 text-indigo-500 animate-pulse" />
                  <div>
                    <div className="text-sm font-medium">{req.nodeName}</div>
                    <div className="text-xs text-zinc-500">
                      {req.nodeUrl} &middot; {formatRelativeTime(req.created)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => respond.mutate({ id: req.id, action: 'accept' })}
                    disabled={respond.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded-md hover:bg-green-500 disabled:opacity-50"
                  >
                    {respond.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Accept
                  </button>
                  <button
                    onClick={() => respond.mutate({ id: req.id, action: 'deny' })}
                    disabled={respond.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs border border-zinc-300 dark:border-zinc-600 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
                  >
                    <X className="w-3 h-3" />
                    Deny
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outgoing requests */}
      {outgoing.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Pending Requests
          </h3>
          <div className="space-y-2">
            {outgoing.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between p-3 border border-zinc-200 dark:border-zinc-800 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
                  <div>
                    <div className="text-sm font-medium">{req.nodeName}</div>
                    <div className="text-xs text-zinc-500">
                      Waiting for approval &middot; {formatRelativeTime(req.created)}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-zinc-400">Expires in ~10 min</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
