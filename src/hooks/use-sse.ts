'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useTier } from '@/hooks/use-tier';

export function useSSEBusEvents() {
  const qc = useQueryClient();
  const { hasCollaboration } = useTier();

  useEffect(() => {
    if (!hasCollaboration) return;

    const es = new EventSource(api('/api/events'));

    const handleMessage = () => {
      qc.invalidateQueries({ queryKey: ['workspace-messages'] });
    };
    const handleContext = () => {
      qc.invalidateQueries({ queryKey: ['workspace-context'] });
    };

    es.addEventListener('workspace:message', handleMessage);
    es.addEventListener('workspace:request', handleMessage);
    es.addEventListener('workspace:context_updated', handleContext);

    return () => {
      es.removeEventListener('workspace:message', handleMessage);
      es.removeEventListener('workspace:request', handleMessage);
      es.removeEventListener('workspace:context_updated', handleContext);
      es.close();
    };
  }, [qc, hasCollaboration]);
}
