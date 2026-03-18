import { NextResponse } from 'next/server';
import { getTierFlags } from '@/lib/tier';
import { isCortexAvailable } from '@/lib/cortex';

export const dynamic = 'force-dynamic';

export function GET() {
  const flags = getTierFlags();
  // cortexTierEnabled = tier supports Cortex (needed to show settings even when toggled off)
  const cortexTierEnabled = flags.hasCortex;
  // hasCortex = tier supports it AND enabled in config (controls nav/hooks/badge)
  if (flags.hasCortex) {
    flags.hasCortex = isCortexAvailable();
  }
  return NextResponse.json({ ...flags, cortexTierEnabled });
}
