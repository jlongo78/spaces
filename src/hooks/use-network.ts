'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NodeRecord, ApiKeyRecord, NodeIdentity, ConnectionRequest } from '@/types/network';
import { api } from '@/lib/api';

// ─── Node Identity ──────────────────────────────────────────

export function useNodeIdentity() {
  return useQuery({
    queryKey: ['node-identity'],
    queryFn: async (): Promise<NodeIdentity> => {
      const res = await fetch(api('/api/network/identity'));
      return res.json();
    },
  });
}

export function useUpdateNodeName() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(api('/api/network/identity'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['node-identity'] });
    },
  });
}

// ─── Nodes ──────────────────────────────────────────────────

export function useNodes(enabled = true) {
  return useQuery({
    queryKey: ['network-nodes'],
    queryFn: async (): Promise<NodeRecord[]> => {
      const res = await fetch(api('/api/network/nodes'));
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled,
  });
}

export function useAddNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { url: string; apiKey: string; name?: string }) => {
      const res = await fetch(api('/api/network/nodes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Failed to add node');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-nodes'] });
    },
  });
}

export function useConnectDiscoveredNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; url: string; apiKey: string; name?: string }) => {
      // Use the same POST flow as addNode — it does the handshake and
      // upserts via ON CONFLICT, so it works for already-discovered nodes.
      const res = await fetch(api('/api/network/nodes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: data.url, apiKey: data.apiKey, name: data.name }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || 'Failed to connect');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-nodes'] });
    },
  });
}

export function useRemoveNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (nodeId: string) => {
      const res = await fetch(api(`/api/network/nodes/${nodeId}`), { method: 'DELETE' });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-nodes'] });
    },
  });
}

// ─── API Keys ───────────────────────────────────────────────

export function useApiKeys() {
  return useQuery({
    queryKey: ['network-api-keys'],
    queryFn: async (): Promise<ApiKeyRecord[]> => {
      const res = await fetch(api('/api/network/keys'));
      return res.json();
    },
  });
}

export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; permissions?: string }): Promise<ApiKeyRecord & { rawKey: string }> => {
      const res = await fetch(api('/api/network/keys'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-api-keys'] });
    },
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(api(`/api/network/keys/${id}`), { method: 'DELETE' });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-api-keys'] });
    },
  });
}

// ─── Health Check ───────────────────────────────────────────

export function useCheckHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api('/api/network/nodes/check'), { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['network-nodes'] });
    },
  });
}

// ─── Connection Requests ───────────────────────────────────

export function useConnectionRequests() {
  return useQuery({
    queryKey: ['connection-requests'],
    queryFn: async (): Promise<{ incoming: ConnectionRequest[]; outgoing: ConnectionRequest[] }> => {
      const res = await fetch(api('/api/network/connect-request'));
      if (!res.ok) return { incoming: [], outgoing: [] };
      return res.json();
    },
    refetchInterval: 5000, // Poll for new requests
  });
}

export function useSendConnectionRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { nodeUrl: string; nodeId: string; nodeName: string }) => {
      // Send through our own server which proxies to the remote node
      // (avoids CORS issues from direct browser-to-remote requests)
      const res = await fetch(api('/api/network/connect-request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _sendRequest: true,
          targetNodeId: data.nodeId,
          targetNodeName: data.nodeName,
          targetNodeUrl: data.nodeUrl,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(body.error || `Request failed (${res.status})`);
      }

      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connection-requests'] });
    },
  });
}

export function useRespondToRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { id: string; action: 'accept' | 'deny' }) => {
      const res = await fetch(api(`/api/network/connect-request/${data.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: data.action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed' }));
        throw new Error(body.error || 'Failed to respond');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['connection-requests'] });
      qc.invalidateQueries({ queryKey: ['network-nodes'] });
    },
  });
}
