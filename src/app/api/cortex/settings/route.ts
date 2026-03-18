import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';
import { readCortexConfig, writeCortexConfig } from '@/lib/cortex/config';
import { resetCortex } from '@/lib/cortex';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, () => {
    const { configPath } = getUserPaths(user);
    const config = readCortexConfig(configPath);
    // Mask API keys — never send full keys to the browser
    const safe = {
      ...config,
      anthropic_api_key: config.anthropic_api_key ? `…${config.anthropic_api_key.slice(-4)}` : '',
      openai_api_key: config.openai_api_key ? `…${config.openai_api_key.slice(-4)}` : '',
    };
    return NextResponse.json(safe);
  });
}

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const { configPath } = getUserPaths(user);
    const updates = await request.json();
    writeCortexConfig(configPath, updates);
    // Force Cortex to re-initialize with new settings on next use
    resetCortex();
    return NextResponse.json({ success: true });
  });
}
