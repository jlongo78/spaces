import { requireNetworkAuth, NetworkAuthError } from '../auth';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spacesHome } from '@/lib/spaces-home';

// Signs a short-lived terminal-auth token bound to the API key's user. The
// matching verifier lives in bin/terminal-server.js — both read the same
// ~/.spaces/terminal_secret file so PTY-attach requests can be authenticated
// out-of-band from the Next.js session cookie.

const TERMINAL_SECRET_PATH = path.join(spacesHome(), 'terminal_secret');

let _terminalSecret: Buffer | null = null;
function terminalSecret(): Buffer {
  if (_terminalSecret) return _terminalSecret;
  if (fs.existsSync(TERMINAL_SECRET_PATH)) {
    _terminalSecret = Buffer.from(fs.readFileSync(TERMINAL_SECRET_PATH, 'utf-8').trim(), 'hex');
    return _terminalSecret;
  }
  const secret = crypto.randomBytes(32);
  const dir = path.dirname(TERMINAL_SECRET_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TERMINAL_SECRET_PATH, secret.toString('hex'), { mode: 0o600 });
  _terminalSecret = secret;
  return secret;
}

function issueTerminalToken(username: string): string {
  const payload = { sub: username, exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', terminalSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

export async function POST(request: Request) {
  let keyRecord;
  try {
    keyRecord = requireNetworkAuth(request);
    if (keyRecord.permissions !== 'terminal' && keyRecord.permissions !== 'admin') {
      return Response.json(
        { error: `API key has "${keyRecord.permissions}" permission — "terminal" or "admin" is required.` },
        { status: 403 }
      );
    }
  } catch (e) {
    if (e instanceof NetworkAuthError) {
      return Response.json({ error: e.message }, { status: 401 });
    }
    throw e;
  }

  const username = keyRecord.username || os.userInfo().username;
  const token = issueTerminalToken(username);

  const host = request.headers.get('host') || 'localhost:3457';
  const protocol = request.headers.get('x-forwarded-proto') === 'https' ? 'wss' : 'ws';

  // In attached mode (default), the terminal WebSocket is on the same port as
  // the HTTP server at /ws. NEXT_PUBLIC_WS_PATH overrides the path, and
  // SPACES_WS_PORT overrides to a standalone terminal server on a separate port.
  const wsPath = process.env.NEXT_PUBLIC_WS_PATH;
  const wsPort = process.env.SPACES_WS_PORT;
  let wsUrl: string;
  if (wsPath) {
    wsUrl = `${protocol}://${host.split(':')[0]}${wsPath}`;
  } else if (wsPort) {
    wsUrl = `ws://${host.split(':')[0]}:${wsPort}`;
  } else {
    wsUrl = `${protocol}://${host}/ws`;
  }

  return Response.json({ token, wsUrl });
}
