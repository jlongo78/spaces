import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

const SECRET_PATH = path.join(process.env.HOME || '/home/' + require('os').userInfo().username, '.spaces', 'session_secret');

function getSessionSecret(): Buffer {
  if (fs.existsSync(SECRET_PATH)) {
    return Buffer.from(fs.readFileSync(SECRET_PATH, 'utf-8').trim(), 'hex');
  }
  const secret = crypto.randomBytes(32);
  const dir = path.dirname(SECRET_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(SECRET_PATH, secret.toString('hex'), { mode: 0o600 });
  return secret;
}

let _sessionSecret: Buffer | null = null;
function sessionSecret(): Buffer {
  if (!_sessionSecret) {
    _sessionSecret = getSessionSecret();
  }
  return _sessionSecret;
}

export function issueSessionToken(username: string, role: string): string {
  const payload = {
    sub: username,
    role,
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string): { sub: string; role: string } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', sessionSecret())
    .update(payloadB64)
    .digest('base64url');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { sub: payload.sub, role: payload.role || 'user' };
  } catch {
    return null;
  }
}

/**
 * Edge-compatible session token verification using Web Crypto API.
 * Used in Next.js middleware (runs in Edge runtime).
 */
export async function verifySessionTokenEdge(token: string, secretHex: string): Promise<{ sub: string; role: string } | null> {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;

  // Import the secret key for HMAC
  const keyData = hexToUint8Array(secretHex);
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );

  // Compute expected signature
  const encoder = new TextEncoder();
  const sigBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadB64));
  const expectedSig = uint8ArrayToBase64url(new Uint8Array(sigBytes));

  if (expectedSig !== sig) {
    return null;
  }

  try {
    const payloadStr = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadStr);
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { sub: payload.sub, role: payload.role || 'user' };
  } catch {
    return null;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function uint8ArrayToBase64url(arr: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Cookie Helpers ────────────────────────────────────────

const COOKIE_NAME = 'spaces-session';

export function setSessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60, // 24 hours
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Get the session secret hex string for use in middleware env var.
 */
export function getSessionSecretHex(): string {
  return sessionSecret().toString('hex');
}
