import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import { HAS_AUTH } from '@/lib/tier';
import { getTeams } from '@/lib/teams';

export async function GET(request: NextRequest) {
  if (!HAS_AUTH) {
    // Desktop mode: return local OS user as admin
    return NextResponse.json({
      username: os.userInfo().username,
      role: 'admin',
      displayName: os.userInfo().username,
    });
  }

  const teams = getTeams();
  if (!teams) {
    return Response.json({ error: 'Requires @spaces/teams' }, { status: 404 });
  }

  return teams.auth.api.me.GET(request);
}
