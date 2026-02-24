'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { NodeRecord, ApiKeyRecord, NodeIdentity } from '@/types/network';
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
