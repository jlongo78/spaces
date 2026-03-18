'use client';

import { createContext, useContext } from 'react';

export interface TierFlags {
  tier: string;
  version: string;
  hasAuth: boolean;
  hasAdmin: boolean;
  hasCollaboration: boolean;
  hasNetwork: boolean;
  hasMultiuser: boolean;
  hasCortex: boolean;
  cortexTierEnabled: boolean;
  isDesktop: boolean;
  basePath: string;
  loading: boolean;
}

const defaults: TierFlags = {
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
};

export const TierContext = createContext<TierFlags>(defaults);

export function useTier(): TierFlags {
  return useContext(TierContext);
}
