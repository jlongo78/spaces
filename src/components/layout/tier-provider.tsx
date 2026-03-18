'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { TierContext, type TierFlags } from '@/hooks/use-tier';
import { api } from '@/lib/api';

export function TierProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<TierFlags>({
    tier: 'community',
    version: '',
    hasAuth: false,
    hasAdmin: false,
    hasCollaboration: false,
    hasNetwork: false,
    hasMultiuser: false,
    hasCortex: false,
    cortexTierEnabled: false,
    isDesktop: true,
    basePath: '',
    loading: false,
  });

  useEffect(() => {
    fetch(api('/api/tier'))
      .then(r => r.json())
      .then(data => {
        setFlags({
          tier: data.tier,
          version: data.version || '',
          hasAuth: data.hasAuth,
          hasAdmin: data.hasAdmin,
          hasCollaboration: data.hasCollaboration ?? false,
          hasNetwork: data.hasNetwork,
          hasMultiuser: data.hasMultiuser,
          hasCortex: data.hasCortex,
          cortexTierEnabled: data.cortexTierEnabled ?? data.hasCortex,
          isDesktop: data.isDesktop,
          basePath: data.basePath || '',
          loading: false,
        });
      })
      .catch(() => {
        // On error, assume community (safe default)
        setFlags(prev => ({ ...prev, loading: false }));
      });
  }, []);

  return (
    <TierContext.Provider value={flags}>
      {children}
    </TierContext.Provider>
  );
}
