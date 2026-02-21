import { NextRequest, NextResponse } from 'next/server';

const isServer = process.env.NEXT_PUBLIC_EDITION === 'server';
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

// Edge-compatible HMAC-SHA256 token verification
async function verifyToken(token: string, secretHex: string): Promise<{ sub: string; role: string } | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;

  // Import secret key
  const keyBytes = new Uint8Array(secretHex.length / 2);
  for (let i = 0; i < secretHex.length; i += 2) {
    keyBytes[i / 2] = parseInt(secretHex.substring(i, i + 2), 16);
  }
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  // Compute expected signature
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
  // Desktop/local mode: pass through
  if (!isServer) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const relativePath = basePath ? pathname.replace(basePath, '') : pathname;

  // Skip auth for login page, auth APIs, static assets, and Next.js internals
  if (
    relativePath === '/login' || relativePath === '/login/' ||
    relativePath.startsWith('/api/auth/') ||
    relativePath.startsWith('/_next/') ||
    relativePath.startsWith('/favicon') ||
    relativePath.endsWith('.png') ||
    relativePath.endsWith('.ico') ||
    relativePath.endsWith('.svg') ||
    relativePath.endsWith('.jpg') ||
    relativePath.endsWith('.css') ||
    relativePath.endsWith('.js')
  ) {
    return NextResponse.next();
  }

  // Validate session cookie
  const sessionToken = request.cookies.get('spaces-session')?.value;
  const secretHex = process.env.SPACES_SESSION_SECRET || '';

  if (!secretHex) {
    // No secret configured — redirect to login with error
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = basePath + '/login';
    loginUrl.searchParams.set('error', 'no-secret');
    return NextResponse.redirect(loginUrl);
  }

  if (!sessionToken) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = basePath + '/login';
    loginUrl.searchParams.set('redirectTo', relativePath);
    return NextResponse.redirect(loginUrl);
  }

  const session = await verifyToken(sessionToken, secretHex);
  if (!session) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = basePath + '/login';
    loginUrl.searchParams.set('redirectTo', relativePath);
    return NextResponse.redirect(loginUrl);
  }

  // Set auth headers on the forwarded request
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-auth-user', session.sub);
  requestHeaders.set('x-auth-role', session.role);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: [
    // Match all paths except _next/static and _next/image
    '/((?!_next/static|_next/image).*)',
  ],
};
