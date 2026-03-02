'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface WorkspaceMessage {
  id: number;
  workspaceId: number;
  paneId: string | null;
  senderName: string;
  type: string;
  content: string;
  targetPaneId: string | null;
  status: string;
  created: string;
  metadata: string;
}

export interface WorkspaceContextEntry {
  workspaceId: number;
  key: string;
  value: string;
  updatedBy: string;
  updated: string;
}

// ─── Messages ───────────────────────────────────────────────

export function useWorkspaceMessages(workspaceId: number | null, opts?: { type?: string }) {
  return useQuery({
    queryKey: ['workspace-messages', workspaceId, opts],
    queryFn: async (): Promise<WorkspaceMessage[]> => {
      const sp = new URLSearchParams();
      if (opts?.type) sp.set('type', opts.type);
      const res = await fetch(api(`/api/workspaces/${workspaceId}/messages?${sp}`));
      return res.json();
    },
    enabled: !!workspaceId,
    refetchInterval: 3000, // Poll every 3s as fallback (SSE is primary)
  });
}

export function usePostMessage(workspaceId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (msg: { content: string; senderName?: string; targetPaneId?: string; type?: string }) => {
      const res = await fetch(api(`/api/workspaces/${workspaceId}/messages`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...msg,
          senderName: msg.senderName || 'User',
          type: msg.type || 'message',
        }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-messages', workspaceId] });
    },
  });
}

export function useUpdateMessageStatus(workspaceId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, status }: { messageId: number; status: 'approved' | 'rejected' }) => {
      const res = await fetch(api(`/api/workspaces/${workspaceId}/messages/${messageId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-messages', workspaceId] });
    },
  });
}

// ─── Context ────────────────────────────────────────────────

export function useWorkspaceContext(workspaceId: number | null) {
  return useQuery({
    queryKey: ['workspace-context', workspaceId],
    queryFn: async (): Promise<WorkspaceContextEntry[]> => {
      const res = await fetch(api(`/api/workspaces/${workspaceId}/context`));
      return res.json();
    },
    enabled: !!workspaceId,
  });
}

export function useSetContext(workspaceId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await fetch(api(`/api/workspaces/${workspaceId}/context/${encodeURIComponent(key)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-context', workspaceId] });
    },
  });
}

export function useDeleteContext(workspaceId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      await fetch(api(`/api/workspaces/${workspaceId}/context/${encodeURIComponent(key)}`), {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-context', workspaceId] });
    },
  });
}

export function useClearMessages(workspaceId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch(api(`/api/workspaces/${workspaceId}/messages`), { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-messages', workspaceId] });
    },
  });
}

export function useClearContext(workspaceId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch(api(`/api/workspaces/${workspaceId}/context`), { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-context', workspaceId] });
    },
  });
}
