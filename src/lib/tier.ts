export type Tier = 'community' | 'team' | 'federation';

// Tier resolution: SPACES_TIER (set by bin/spaces.js launcher) is primary,
// with NEXT_PUBLIC_TIER and NEXT_PUBLIC_EDITION as backward-compat fallbacks.
// Auto-detection of @spaces/pro and license verification happen in the launcher,
// NOT here, because this module is imported by middleware.ts which runs in Edge
// Runtime where Node.js APIs (crypto, fs, require.resolve) are unavailable.
export const TIER: Tier = (process.env.SPACES_TIER as Tier)
  || (process.env.NEXT_PUBLIC_TIER as Tier)
  || (process.env.NEXT_PUBLIC_EDITION === 'server' ? 'federation' : 'community');

export const IS_TEAM = TIER === 'team' || TIER === 'federation';
export const IS_FEDERATION = TIER === 'federation';
export const HAS_AUTH = IS_TEAM;
export const HAS_MULTIUSER = IS_TEAM;
export const HAS_ADMIN = IS_TEAM;
export const HAS_COLLABORATION = IS_TEAM;
export const HAS_NETWORK = IS_FEDERATION;
export const HAS_CORTEX = IS_TEAM || process.env.SPACES_HAS_CORTEX === '1';
export const IS_DESKTOP = !IS_TEAM;

/** Tier flags object for the /api/tier endpoint */
export function getTierFlags() {
  let version = '0.0.0';
  try { version = require('../../package.json').version; } catch {}
  return {
    tier: TIER,
    version,
    hasAuth: HAS_AUTH,
    hasAdmin: HAS_ADMIN,
    hasCollaboration: HAS_COLLABORATION,
    hasNetwork: HAS_NETWORK,
    hasMultiuser: HAS_MULTIUSER,
    hasCortex: HAS_CORTEX,
    isDesktop: IS_DESKTOP,
    basePath: process.env.SPACES_BASE_PATH || '',
  };
}
