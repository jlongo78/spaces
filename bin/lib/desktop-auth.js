'use strict';

/**
 * Authentication for desktop mode.
 *
 * Desktop mode used to treat every connection from 127.0.0.1 as its owner.
 * That holds on a laptop with one user and nothing else listening, and fails
 * everywhere else: on a shared server every other account and every service
 * account could connect to 127.0.0.1 and get a shell as the owner, and a web
 * page could reach it through the owner's browser by rebinding its own
 * hostname to 127.0.0.1 (the Host and Origin headers then agree with each
 * other, which is all the old origin check asked).
 *
 * So every request now has to prove it is the owner, with the one thing
 * only the owner can read: ~/.spaces/internal_token, 32 random bytes, mode
 * 0600 (on Windows, inside the user's own profile). Three ways to present it:
 *
 *   - `Authorization: Bearer <token>`: a token signed with the secret —
 *     a session token for the terminal client, a 60-second one minted per
 *     request by agents, hooks and the MCP bus. Never the secret itself on
 *     the wire: whatever happens to be listening on the port (another
 *     account's process, while Spaces is down) would keep it for good.
 *     Headers only — a token in a URL ends up in logs and histories.
 *   - The `spaces-desktop` cookie: the browser. A token signed with the
 *     secret, HttpOnly (no script reads it) and SameSite=Strict (no other
 *     site sends it). It is never the secret itself.
 *   - A login code, once: `spaces web` mints one and opens the browser on
 *     it; the server swaps it for the cookie. Single use, two minutes.
 *
 * And before any of that, the Host header must name this machine's loopback
 * (or a name the operator configured), which is what stops rebinding: the
 * attacker's page can make the browser connect to 127.0.0.1, but the browser
 * still sends the attacker's hostname.
 *
 * Multiuser mode has its own logins and is untouched by this. Its session
 * cookie has a different name and is signed with a different key, so neither
 * kind of cookie is ever accepted as the other.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DESKTOP_COOKIE = 'spaces-desktop';
/** A browser or terminal-client session. Revoked early by `spaces signout`. */
const SESSION_TTL_S = 7 * 24 * 60 * 60;
const LOGIN_TTL_S = 120;
/** A token a tool mints for one request. */
const API_TTL_S = 60;
const MIN_SECRET_CHARS = 32;
/** The kinds that authenticate a request; a login code only buys a cookie. */
const OWNER_KINDS = ['session', 'api'];

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * True when `host` (a Host header) names the loopback, or one of `allowed`,
 * with an optional numeric port and nothing else.
 */
function isLocalHost(host, allowed = []) {
  if (typeof host !== 'string' || !host) return false;
  const m = /^(\[[0-9a-fA-F:.]+\]|[^:[\]]+)(?::(\d{1,5}))?$/.exec(host.trim());
  if (!m) return false;
  const name = m[1].toLowerCase();
  if (LOOPBACK.has(name)) return true;
  return allowed.some((a) => allowedName(a) === name);
}

/**
 * A `SPACES_ALLOWED_ORIGINS` entry as a bare hostname. Entries are written
 * either way — `spaces.example.com` or `https://spaces.example.com:8443` —
 * and a full origin used to never match anything.
 */
function allowedName(entry) {
  if (typeof entry !== 'string') return '';
  const e = entry.trim().toLowerCase();
  if (!e) return '';
  if (e.includes('://')) {
    try { return new URL(e).hostname; } catch { return ''; }
  }
  return e.replace(/:\d+$/, '');
}

/**
 * For a request that carries an Origin: true only when it is exactly this
 * server's own (`http(s)://<the Host it was sent to>`). Every port on
 * localhost is the same *site*, so SameSite cookies flow between them;
 * comparing the whole origin is what keeps a page served from another local
 * port from driving this server with the owner's cookie. No Origin (a
 * non-browser client) is not this function's business — those carry a
 * bearer token instead.
 */
function originIsSelf(origin, host) {
  if (typeof origin !== 'string' || typeof host !== 'string' || !host) return false;
  const o = origin.trim().toLowerCase();
  const h = host.trim().toLowerCase();
  return o === `http://${h}` || o === `https://${h}`;
}

/** True when `url` points at this machine's loopback. */
function isLoopbackUrl(url) {
  try {
    const { hostname } = new URL(url);
    return LOOPBACK.has(hostname.toLowerCase()) || hostname === '::1';
  } catch {
    return false;
  }
}

function hmac(secret, data) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(data).digest('base64url');
}

function usableSecret(secret) {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_CHARS;
}

/**
 * A token of `kind` ('session' or 'login'), valid for `ttl` seconds from
 * `now` (seconds). The kind is inside the signature, so one can never be
 * used as the other.
 */
function signDesktop(secret, kind, ttl, now = Math.floor(Date.now() / 1000)) {
  if (!usableSecret(secret)) throw new Error('desktop secret missing or too short');
  const payload = Buffer.from(JSON.stringify({
    k: kind,
    exp: now + ttl,
    n: crypto.randomBytes(16).toString('base64url'),
  })).toString('base64url');
  return `${payload}.${hmac(secret, `spaces-desktop:${payload}`)}`;
}

/** The payload of a valid, unexpired token of `kind`, or null. */
function verifyDesktop(secret, token, kind, now = Math.floor(Date.now() / 1000)) {
  if (!usableSecret(secret) || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = Buffer.from(hmac(secret, `spaces-desktop:${parts[0]}`));
  const given = Buffer.from(parts[1]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || payload.k !== kind || typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload;
}

/**
 * Login codes: minted by whoever holds the secret (`spaces web`, or the
 * server opening a browser itself), redeemed by the server exactly once.
 * The used-set only has to outlive a code's two minutes.
 */
function createLoginCodes(getSecret, clock = () => Math.floor(Date.now() / 1000)) {
  const used = new Map(); // nonce -> exp
  return {
    mint() {
      return signDesktop(getSecret(), 'login', LOGIN_TTL_S, clock());
    },
    redeem(code) {
      const now = clock();
      for (const [nonce, exp] of used) if (exp < now) used.delete(nonce);
      const payload = verifyDesktop(getSecret(), code, 'login', now);
      if (!payload || used.has(payload.n)) return false;
      used.set(payload.n, payload.exp);
      return true;
    },
  };
}

/** The Set-Cookie value for a browser session. */
function desktopCookie(value, basePath = '') {
  const cookiePath = basePath && basePath !== '/' ? basePath : '/';
  return `${DESKTOP_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=${cookiePath}; Max-Age=${SESSION_TTL_S}`;
}

/** The secret presented in `headers` (lower-cased keys), or ''. */
function presentedSecret(headers = {}) {
  const auth = headers.authorization;
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)\s*$/i.exec(auth);
    if (m) return m[1];
  }
  const internal = headers['x-spaces-internal'];
  return typeof internal === 'string' ? internal.trim() : '';
}

/**
 * True when `presented` (from a header) proves the owner: the secret itself,
 * or an unexpired session or per-request token signed with it.
 */
function isOwnerCredential(secret, presented) {
  if (!presented) return false;
  if (secretMatches(secret, presented)) return true;
  return OWNER_KINDS.some((kind) => !!verifyDesktop(secret, presented, kind));
}

/**
 * The headers a tool on the owner's account sends with a request to
 * `apiUrl`: a fresh 60-second token, and only when `apiUrl` is this
 * machine's loopback. A project's MCP config can name any URL; the owner's
 * credentials must not follow it off the machine.
 */
function clientAuthHeaders(apiUrl, secret = readSecret()) {
  if (!secret || !isLoopbackUrl(apiUrl)) return {};
  try {
    return { Authorization: `Bearer ${signDesktop(secret, 'api', API_TTL_S)}` };
  } catch {
    return {};
  }
}

/** Constant-time equality of two secrets; never true for empty input. */
function secretMatches(expected, given) {
  if (!usableSecret(expected) || typeof given !== 'string' || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The owner's secret: `SPACES_INTERNAL_TOKEN` when the environment sets it
 * (the server prefers it too, so the two always agree), else
 * ~/.spaces/internal_token; '' when there is none yet.
 */
function readSecret(spacesDir = require('./spaces-home').spacesHome()) {
  const fromEnv = process.env.SPACES_INTERNAL_TOKEN;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    return fs.readFileSync(path.join(spacesDir, 'internal_token'), 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * The answer to a redeemed sign-in link: the cookie, and a page that moves on
 * to the app.
 *
 * Not a redirect. A link opened from a local file (how Linux opens it, to
 * keep it out of every account's process list) or another app is a
 * cross-site navigation, and a browser that follows a redirect from it still
 * counts the next request as cross-site — so it withholds the SameSite=Strict
 * cookie it was just given and the app shows "not signed in". A page served
 * from here that navigates on is a same-site navigation, which sends it.
 */
function signedInPage(res, cookie, target) {
  const safe = String(target).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  res.writeHead(200, {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'",
    'Set-Cookie': cookie,
  });
  res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${safe}">`
    + `<title>Spaces</title><a href="${safe}">Open Spaces</a>`);
}

module.exports = {
  signedInPage,
  DESKTOP_COOKIE,
  SESSION_TTL_S,
  LOGIN_TTL_S,
  API_TTL_S,
  isLocalHost,
  allowedName,
  originIsSelf,
  isLoopbackUrl,
  isOwnerCredential,
  clientAuthHeaders,
  signDesktop,
  verifyDesktop,
  createLoginCodes,
  desktopCookie,
  presentedSecret,
  secretMatches,
  readSecret,
};
