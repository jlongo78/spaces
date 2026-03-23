import { useQuery } from '@tanstack/react-query';
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
