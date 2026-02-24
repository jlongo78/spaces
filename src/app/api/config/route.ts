import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { readConfig, writeConfig } from '@/lib/config';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, () => {
    const config = readConfig(user);
    return NextResponse.json(config);
  });
}

export async function PUT(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (typeof body.telemetryOptOut === 'boolean') {
      updates.telemetryOptOut = body.telemetryOptOut;
    }
    if (Array.isArray(body.devDirectories)) {
      const { isAbsolute, resolve } = require('path');
      updates.devDirectories = body.devDirectories
        .filter((d: unknown) => typeof d === 'string' && isAbsolute(d))
        .map((d: string) => resolve(d));
    }
    const config = writeConfig(user, updates);
    return NextResponse.json(config);
  });
}
