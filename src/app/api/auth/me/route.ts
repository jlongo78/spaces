import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import { HAS_AUTH } from '@/lib/tier';
import { getPro } from '@/lib/pro';

export async function GET(request: NextRequest) {
  if (!HAS_AUTH) {
    // Desktop mode: return local OS user as admin
    return NextResponse.json({
      username: os.userInfo().username,
      role: 'admin',
      displayName: os.userInfo().username,
    });
  }

  const pro = getPro();
  if (!pro) {
    return Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });
  }

  return pro.auth.api.me.GET(request);
}
