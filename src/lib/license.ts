import { createPublicKey, verify } from 'crypto';

// Ed25519 public key for license verification (asymmetric — safe to embed)
// Replace with actual public key from: node scripts/keygen.js
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEApnho5Ufnuut0LbsnVadxr0NKOTYz3ojX0W5n6zfFIUk=
-----END PUBLIC KEY-----`;

export interface License {
  tier: 'server' | 'team' | 'federation';
  sub: string;        // customer email
  maxUsers?: number;  // for team tier
  iat: number;
  exp: number;
}

/**
 * Verify an Ed25519-signed JWT license key offline.
 * Returns the decoded license payload or null if invalid/expired.
 */
export function verifyLicense(token: string): License | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify header declares EdDSA
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
    if (header.alg !== 'EdDSA') return null;

    // Verify signature
    const publicKey = createPublicKey(PUBLIC_KEY_PEM);
    const data = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(signatureB64, 'base64url');
    const valid = verify(null, data, publicKey, signature);
    if (!valid) return null;

    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return {
      tier: payload.tier,
      sub: payload.sub,
      maxUsers: payload.maxUsers,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
