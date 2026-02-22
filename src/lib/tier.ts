import { verifyLicense } from './license';
import { hasPro } from './pro';

export type Tier = 'community' | 'server' | 'team' | 'federation';

// Env-based tier (for self-hosters who set NEXT_PUBLIC_TIER manually)
const ENV_TIER: Tier = (process.env.NEXT_PUBLIC_TIER as Tier)
  || (process.env.NEXT_PUBLIC_EDITION === 'server' ? 'federation' : 'community');

// License-based tier override (for paying customers)
function resolveTier(): Tier {
  const licenseToken = process.env.SPACES_LICENSE;
  if (licenseToken) {
    const license = verifyLicense(licenseToken);
    if (license && hasPro()) return license.tier;
    if (license && !hasPro()) {
      console.warn('[spaces] Valid license found but @spaces/pro is not installed — falling back to community tier');
    }
  }

  const envTier = ENV_TIER;
  if (envTier !== 'community' && !hasPro()) {
    console.warn(`[spaces] NEXT_PUBLIC_TIER=${envTier} but @spaces/pro is not installed — falling back to community tier`);
    return 'community';
  }

  return envTier;
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
