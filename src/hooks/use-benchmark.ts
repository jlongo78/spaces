import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useBenchmarkRuns() {
  return useQuery({
    queryKey: ['benchmark', 'runs'],
    queryFn: async () => {
      const res = await fetch(api('/api/benchmark/runs'));
      if (!res.ok) return null;
      return res.json();
    },
  });
}

export function useBenchmarkRun(runId: string | null) {
  return useQuery({
    queryKey: ['benchmark', 'run', runId],
    queryFn: async () => {
      if (!runId) return null;
      const res = await fetch(api(`/api/benchmark/runs/${runId}`));
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!runId,
  });
}

export function useBenchmarkLobes() {
  return useQuery({
    queryKey: ['benchmark', 'lobes'],
    queryFn: async () => {
      const res = await fetch(api('/api/benchmark/lobes'));
      if (!res.ok) return null;
      return res.json();
    },
  });
}

export function useBenchmarkStatus() {
  return useQuery({
    queryKey: ['benchmark', 'status'],
    queryFn: async () => {
      const res = await fetch(api('/api/benchmark/status'));
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 3000, // Poll every 3s while page is mounted
  });
}

export function useStartBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (config: {
      preset: string;
      categories?: string;
      noJudge?: boolean;
      model?: string;
    }) => {
      const res = await fetch(api('/api/benchmark/run'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['benchmark'] });
    },
  });
}
