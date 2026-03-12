import type { ScoredKnowledge } from '../knowledge/types';
import { api } from '@/lib/api';

interface FederationQueryOpts {
  query: string;
  queryVector: number[];
  connectedNodes: Array<{ id: string; url: string }>;
  timeoutMs?: number;
  limit?: number;
}

export async function federationSearch(
  opts: FederationQueryOpts,
): Promise<ScoredKnowledge[]> {
  const { connectedNodes, queryVector, timeoutMs = 500, limit = 5 } = opts;

  const promises = connectedNodes.map(async (node) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(
        api(`/api/network/proxy/${node.id}/api/cortex/federation/search?q=${encodeURIComponent(opts.query)}&limit=${limit}`),
        { signal: controller.signal },
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.results || []).map((r: any) => ({
        ...r,
        metadata: { ...r.metadata, source_node: node.id },
      }));
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  });

  const remoteResults = (await Promise.all(promises)).flat();

  return remoteResults
    .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
    .slice(0, limit);
}
