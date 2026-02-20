'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionWithMeta, Project, SearchResult, AnalyticsOverview, ParsedMessage, Tag, Workspace } from '@/types/claude';
import { api } from '@/lib/api';

// ─── Sessions ───────────────────────────────────────────────

interface SessionsParams {
  projectId?: string;
  starred?: boolean;
  search?: string;
  sortBy?: string;
  sortDir?: string;
  offset?: number;
  limit?: number;
}

export function useSessions(params: SessionsParams = {}) {
  return useQuery({
    queryKey: ['sessions', params],
    queryFn: async (): Promise<{ sessions: SessionWithMeta[]; total: number }> => {
      const sp = new URLSearchParams();
      if (params.projectId) sp.set('projectId', params.projectId);
      if (params.starred !== undefined) sp.set('starred', String(params.starred));
      if (params.search) sp.set('search', params.search);
      if (params.sortBy) sp.set('sortBy', params.sortBy);
      if (params.sortDir) sp.set('sortDir', params.sortDir);
      if (params.offset !== undefined) sp.set('offset', String(params.offset));
      if (params.limit !== undefined) sp.set('limit', String(params.limit));

      const res = await fetch(api(`/api/sessions?${sp}`));
      return res.json();
    },
  });
}

export function useSession(id: string | null) {
  return useQuery({
    queryKey: ['session', id],
    queryFn: async (): Promise<SessionWithMeta & { tagObjects?: Tag[]; workspaces?: Workspace[] }> => {
      const res = await fetch(api(`/api/sessions/${id}`));
      if (!res.ok) throw new Error('Session not found');
      return res.json();
    },
    enabled: !!id,
  });
}

export function useMessages(sessionId: string | null, offset = 0, limit = 50) {
  return useQuery({
    queryKey: ['messages', sessionId, offset, limit],
    queryFn: async (): Promise<{ messages: ParsedMessage[]; total: number; hasMore: boolean }> => {
      const res = await fetch(api(`/api/sessions/${sessionId}/messages?offset=${offset}&limit=${limit}`));
      return res.json();
    },
    enabled: !!sessionId,
  });
}

// ─── Session Actions ────────────────────────────────────────

export function useToggleStar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(api(`/api/sessions/${sessionId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'star' }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useUpdateNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, notes }: { sessionId: string; notes: string }) => {
      const res = await fetch(api(`/api/sessions/${sessionId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'notes', notes }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useAddTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, tagName }: { sessionId: string; tagName: string }) => {
      const res = await fetch(api(`/api/sessions/${sessionId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tag', tagName }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['session'] });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useRemoveTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, tagName }: { sessionId: string; tagName: string }) => {
      const res = await fetch(api(`/api/sessions/${sessionId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'removeTag', tagName }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['session'] });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useRenameSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, name }: { sessionId: string; name: string }) => {
      const res = await fetch(api(`/api/sessions/${sessionId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', name }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

// ─── Tags ───────────────────────────────────────────────────

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: async (): Promise<Tag[]> => {
      const res = await fetch(api('/api/tags'));
      return res.json();
    },
  });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, color }: { name: string; color?: string }) => {
      const res = await fetch(api('/api/tags'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, color }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tagId: number) => {
      const res = await fetch(api('/api/tags'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', tagId }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useUpdateTagColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ tagId, color }: { tagId: number; color: string }) => {
      const res = await fetch(api('/api/tags'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateColor', tagId, color }),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tags'] });
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

// ─── Workspaces ─────────────────────────────────────────────

export function useWorkspaces() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: async (): Promise<Workspace[]> => {
      const res = await fetch(api('/api/workspaces'));
      return res.json();
    },
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { name: string; description?: string; color?: string }) => {
      const res = await fetch(api('/api/workspaces'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number; name?: string; description?: string; color?: string }) => {
      const res = await fetch(api(`/api/workspaces/${id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(api(`/api/workspaces/${id}`), { method: 'DELETE' });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useWorkspaceSessions(workspaceId: number | null) {
  return useQuery({
    queryKey: ['workspace-sessions', workspaceId],
    queryFn: async (): Promise<SessionWithMeta[]> => {
      const res = await fetch(api(`/api/workspaces/${workspaceId}`));
      return res.json();
    },
    enabled: workspaceId !== null,
  });
}

export function useAddSessionToWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, sessionId }: { workspaceId: number; sessionId: string }) => {
      const res = await fetch(api(`/api/workspaces/${workspaceId}/sessions`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error('Failed to add session to workspace');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      qc.invalidateQueries({ queryKey: ['workspace-sessions'] });
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

export function useRemoveSessionFromWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ workspaceId, sessionId }: { workspaceId: number; sessionId: string }) => {
      const res = await fetch(api(`/api/workspaces/${workspaceId}/sessions`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error('Failed to remove session from workspace');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      qc.invalidateQueries({ queryKey: ['workspace-sessions'] });
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

// ─── Bulk Operations ────────────────────────────────────────

export function useBulkAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { sessionIds: string[]; action: string; tagName?: string; workspaceId?: number }) => {
      const res = await fetch(api('/api/bulk'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      qc.invalidateQueries({ queryKey: ['tags'] });
    },
  });
}

// ─── Projects ───────────────────────────────────────────────

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: async (): Promise<Project[]> => {
      const res = await fetch(api('/api/projects'));
      return res.json();
    },
  });
}

// ─── Search ─────────────────────────────────────────────────

export function useSearch(query: string, projectId?: string) {
  return useQuery({
    queryKey: ['search', query, projectId],
    queryFn: async (): Promise<{ results: SearchResult[]; query: string }> => {
      const sp = new URLSearchParams({ q: query });
      if (projectId) sp.set('projectId', projectId);
      const res = await fetch(api(`/api/search?${sp}`));
      return res.json();
    },
    enabled: query.length >= 2,
  });
}

// ─── Analytics ──────────────────────────────────────────────

export function useAnalytics() {
  return useQuery({
    queryKey: ['analytics'],
    queryFn: async (): Promise<AnalyticsOverview> => {
      const res = await fetch(api('/api/analytics/overview'));
      return res.json();
    },
  });
}

// ─── Sync ───────────────────────────────────────────────────

export function useSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api('/api/sync'), { method: 'POST' });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}
