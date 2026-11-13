import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { IS_MULTIUSER } from '@/lib/flags';
import { spacesHome } from '@/lib/spaces-home';

const SECRET_PATH = path.join(spacesHome(process.env.HOME || process.env.USERPROFILE || require('os').homedir()), 'session_secret');

function getSessionSecret(): Buffer {
  // Prefer the env var set by the spaces launcher — guaranteed to match middleware
  if (process.env.SPACES_SESSION_SECRET) {
    return Buffer.from(process.env.SPACES_SESSION_SECRET, 'hex');
  }
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

export function issueSessionToken(username: string, role: string, ver: number = 0): string {
  const payload = {
    sub: username,
    role,
    ver, // review M7: token version, checked against the DB to allow revocation
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string): { sub: string; role: string; ver: number } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', sessionSecret())
    .update(payloadB64)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { sub: payload.sub, role: payload.role || 'user', ver: payload.ver ?? 0 };
  } catch {
    return null;
  }
}

const COOKIE_NAME = 'spaces-session';

/**
 * Set `Secure` whenever multiuser auth is on (the cookie matters), unless
 * the operator has explicitly opted out via SPACES_SECURE_COOKIES=0 (e.g.
 * for local LAN testing without TLS). Multiuser mode is meant to be served
 * over HTTPS, so failing closed by default is correct.
 */
function isSecureCookie(): boolean {
  if (process.env.SPACES_SECURE_COOKIES === '0') return false;
  if (process.env.SPACES_SECURE_COOKIES === '1') return true;
  // review L5: key off IS_MULTIUSER (the same flag that enforces auth) rather
  // than SPACES_MULTIUSER alone, so enabling multiuser via NEXT_PUBLIC_MULTIUSER
  // can't silently ship the session cookie without the Secure attribute.
  return IS_MULTIUSER;
}

export function setSessionCookie(response: Response, token: string): void {
  const maxAge = 24 * 60 * 60;
  const secure = isSecureCookie();
  const cookie = `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  response.headers.append('Set-Cookie', cookie);
}

export function clearSessionCookie(response: Response): void {
  const secure = isSecureCookie();
  const cookie = `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
  response.headers.append('Set-Cookie', cookie);
}

export function getSessionSecretHex(): string {
  return sessionSecret().toString('hex');
}
