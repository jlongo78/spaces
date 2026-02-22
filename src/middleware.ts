import { NextRequest, NextResponse } from 'next/server';
import { HAS_AUTH, HAS_NETWORK, HAS_ADMIN } from '@/lib/tier';

let _pro: any = null;
let _proChecked = false;

function getProMiddleware() {
  if (!_proChecked) {
    try { _pro = require('@spaces/pro'); } catch {}
    _proChecked = true;
  }
  return _pro;
}

export async function middleware(request: NextRequest) {
  // Desktop/local mode: pass through
  if (!HAS_AUTH) {
    return NextResponse.next();
  }

  const pro = getProMiddleware();
  if (!pro) {
    // Pro not installed — pass through (no auth enforcement)
    return NextResponse.next();
  }

  // Delegate all auth logic to @spaces/pro
  return pro.middleware(request);
}

export const config = {
  matcher: [
    // Explicitly match root
    '/',
    // Match all paths except _next/static and _next/image
    '/((?!_next/static|_next/image).*)',
  ],
};
