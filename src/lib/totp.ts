import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { TOTP, Secret } from 'otpauth';

const SECRET_PATH = path.join(process.env.HOME || '/home/' + require('os').userInfo().username, '.spaces', 'terminal_secret');

function getTerminalSecret(): Buffer {
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

let _terminalSecret: Buffer | null = null;
function terminalSecret(): Buffer {
  if (!_terminalSecret) {
    _terminalSecret = getTerminalSecret();
  }
  return _terminalSecret;
}

export function generateSecret(username: string): { secret: string; uri: string; qrDataUrl?: string } {
  const totp = new TOTP({
    issuer: 'Spaces',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: new Secret({ size: 20 }),
  });

  return {
    secret: totp.secret.base32,
    uri: totp.toString(),
  };
}

export function verifyCode(secret: string, code: string): boolean {
  const totp = new TOTP({
    issuer: 'Spaces',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

export function issueTerminalToken(username: string): string {
  const payload = {
    sub: username,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60, // 8 hours
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');
  const sig = crypto.createHmac('sha256', terminalSecret())
    .update(payloadB64)
    .digest('base64url');
  return `${payloadB64}.${sig}`;
}

export function verifyTerminalToken(token: string): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', terminalSecret())
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
    return payload.sub || null;
  } catch {
    return null;
  }
}
