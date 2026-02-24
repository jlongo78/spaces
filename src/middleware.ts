import { NextRequest, NextResponse } from 'next/server';
import { HAS_AUTH } from '@/lib/tier';

async function verifyToken(token: string, secretHex: string): Promise<{ sub: string; role: string } | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;

  const keyBytes = new Uint8Array(secretHex.length / 2);
  for (let i = 0; i < secretHex.length; i += 2) {
    keyBytes[i / 2] = parseInt(secretHex.substring(i, i + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  if (expectedSig !== sig) return null;

  try {
    const payloadStr = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadStr);
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: payload.sub, role: payload.role || 'user' };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  if (!HAS_AUTH) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;

  // Skip auth for login page, specific auth APIs, static assets, and Next.js internals
  if (
    pathname === '/login' || pathname === '/login/' ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/logout') ||
    pathname.startsWith('/api/auth/totp/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js')
  ) {
    return NextResponse.next();
  }

  // Federation API routes authenticate via Bearer token
  if (pathname.startsWith('/api/network/') && request.headers.get('authorization')?.startsWith('Bearer ')) {
    return NextResponse.next();
  }

  // Validate session cookie
  const sessionToken = request.cookies.get('spaces-session')?.value;
  const secretHex = process.env.SPACES_SESSION_SECRET || '';

  if (!secretHex) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('error', 'no-secret');
    return NextResponse.redirect(loginUrl);
  }

  if (!sessionToken) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const session = await verifyToken(sessionToken, secretHex);
  if (!session) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Set auth headers on the forwarded request
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-auth-user', session.sub);
  requestHeaders.set('x-auth-role', session.role);

  // Auto-redirect mobile users
  if (pathname === '/' || pathname === '') {
    const ua = request.headers.get('user-agent') || '';
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    if (isMobile) {
      const mobileUrl = request.nextUrl.clone();
      mobileUrl.pathname = '/m/';
      return NextResponse.redirect(mobileUrl);
    }
  }

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    '/',
    '/((?!_next/static|_next/image).*)',
  ],
};
