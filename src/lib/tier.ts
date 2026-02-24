import { verifyLicense } from './license';

export type Tier = 'community' | 'server' | 'team' | 'federation';

// Env-based tier (for self-hosters who set NEXT_PUBLIC_TIER manually)
const ENV_TIER: Tier = (process.env.NEXT_PUBLIC_TIER as Tier)
  || (process.env.NEXT_PUBLIC_EDITION === 'server' ? 'federation' : 'community');

function resolveTier(): Tier {
  const licenseToken = process.env.SPACES_LICENSE;
  if (licenseToken) {
    const license = verifyLicense(licenseToken);
    if (license) return license.tier;
  }

  return ENV_TIER;
}

export const TIER: Tier = resolveTier();

export const IS_SERVER = TIER !== 'community';
export const IS_TEAM = TIER === 'team' || TIER === 'federation';
export const IS_FEDERATION = TIER === 'federation';
export const HAS_AUTH = IS_SERVER;
export const HAS_MULTIUSER = IS_TEAM;
export const HAS_ADMIN = IS_TEAM;
export const HAS_NETWORK = IS_FEDERATION;
export const IS_DESKTOP = TIER === 'community';
