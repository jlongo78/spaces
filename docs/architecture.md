# Spaces Architecture

Developer reference for the Spaces codebase and the `@spaces/pro` extraction.

## System Overview

Spaces is a workspace manager for AI coding agents. It runs as three cooperating processes:

1. **Next.js app** (port 3457) — Web UI, API routes, SSR pages.
2. **Terminal server** (port 3458) — WebSocket server that spawns PTY processes via `node-pty` and streams I/O to `xterm.js` in the browser.
3. **Electron wrapper** (optional) — Wraps the Next.js app in a desktop window for the Community tier.

```
┌──────────────────────────────────────────────────┐
│  Browser / Electron                              │
│  ┌───────────┐  ┌───────────┐  ┌──────────────┐ │
│  │ xterm.js  │  │ React UI  │  │ Session      │ │
│  │ (panes)   │  │ (sidebar, │  │ browser      │ │
│  │           │  │  dash)    │  │ (FTS5)       │ │
│  └─────┬─────┘  └─────┬─────┘  └──────┬───────┘ │
└────────┼──────────────┼────────────────┼─────────┘
         │ WebSocket    │ HTTP           │ HTTP
         ▼              ▼                ▼
  ┌──────────────┐  ┌──────────────────────────┐
  │ terminal-    │  │ Next.js API routes       │
  │ server.js    │  │ (port 3457)              │
  │ (port 3458)  │  │                          │
  │ node-pty     │  │ SQLite DB (FTS5)         │
  └──────────────┘  └──────────────────────────┘
```

## Open-Core Model

The codebase is split into two packages:

| Package | Repository | License | Contents |
|---------|-----------|---------|----------|
| `agent-spaces` | `jlongo78/spaces` (public) | MIT | Community features, UI, terminal, session browser |
| `@spaces/pro` | Private | Proprietary | Auth, admin, federation networking |

The public repo works standalone for the Community tier. Paid tiers (Server, Team, Federation) require `@spaces/pro` to be installed as an npm dependency.

### Extension Bridge (`src/lib/pro.ts`)

The bridge uses a lazy `require()` to load `@spaces/pro` at runtime:

```typescript
let _pro: any = null;
let _checked = false;

export function getPro() {
  if (!_checked) {
    try { _pro = require('@spaces/pro'); } catch {}
    _checked = true;
  }
  return _pro;
}

export function hasPro(): boolean {
  return getPro() !== null;
}
```

This allows the public repo to compile and run without `@spaces/pro` present.

### Stub Route Pattern

API routes that delegate to `@spaces/pro` follow a consistent pattern:

```typescript
import { NextRequest } from 'next/server';
import { getPro } from '@/lib/pro';

const notAvailable = () =>
  Response.json({ error: 'Requires @spaces/pro' }, { status: 404 });

export async function POST(req: NextRequest) {
  const pro = getPro();
  return pro?.auth.api.login.POST(req) ?? notAvailable();
}
```

Routes return 404 with `"Requires @spaces/pro"` when the package is not installed.

### Aggregation Pattern

Some Community routes have optional federation aggregation. For example, `src/app/api/search/route.ts` returns local results by default, but if `?nodes=all` is passed and `@spaces/pro` is installed, it aggregates results from remote nodes:

```typescript
if (searchParams.get('nodes') === 'all') {
  try {
    const pro = require('@spaces/pro');
    const { aggregateSearch } = pro.network;
    const aggregated = await aggregateSearch(localResults, q, remoteParams);
    return NextResponse.json({ results: aggregated.results, ... });
  } catch { /* return local only */ }
}
```

## Tier System

### How It Works

`src/lib/tier.ts` resolves the active tier on startup:

1. Read `NEXT_PUBLIC_TIER` env var (fallback: legacy `NEXT_PUBLIC_EDITION`).
2. If `SPACES_LICENSE` is set, verify the Ed25519 JWT via `src/lib/license.ts`.
3. Check if `@spaces/pro` is installed via `hasPro()`.
4. If a paid tier is requested but pro is missing, fall back to `community` with a warning.

### Feature Flags

| Flag | True when | Controls |
|------|-----------|----------|
| `IS_SERVER` | `!= community` | Auth enforcement |
| `IS_TEAM` | `team \| federation` | Multi-user, admin |
| `IS_FEDERATION` | `federation` | Networking |
| `HAS_AUTH` | `= IS_SERVER` | Login required |
| `HAS_MULTIUSER` | `= IS_TEAM` | User management |
| `HAS_ADMIN` | `= IS_TEAM` | Admin panel |
| `HAS_NETWORK` | `= IS_FEDERATION` | Node networking |
| `IS_DESKTOP` | `= community` | Personal mode |

> **Note:** `IS_DESKTOP` is a misnomer. It really means "personal/local mode" — Community tier runs in the browser too, not just Electron. Renaming it would touch many files, so it's left as-is with this caveat.

### License Verification

`src/lib/license.ts` verifies Ed25519-signed JWT tokens offline. The public key is embedded in the source (safe — it's asymmetric). Licenses encode tier, subscriber email, optional `maxUsers`, and expiration.

## Database

SQLite via `better-sqlite3`, stored at `~/.spaces/spaces.db` (per-user in multi-user mode).

### Key Tables

- **workspaces** — Named, color-coded workspace groups
- **sessions** — Claude Code session metadata (imported from `~/.claude/projects/`)
- **messages** — Session messages (FTS5-indexed for full-text search)
- **projects** — Project directories

### Full-Text Search

Messages are indexed with SQLite FTS5 for fast search. The search API supports query syntax, project filtering, and pagination.

### User-Scoped Data

`src/lib/auth.ts` provides `AsyncLocalStorage`-based user context. `withUser(username, fn)` sets the current user for the duration of `fn`, so `getCurrentUser()` resolves correctly in nested calls (e.g., `getDb()` opens the right per-user database).

In multi-user mode, `config.ts` resolves the OS shell user via `@spaces/pro`'s `admin.resolveShellUser()` to find the correct `~/.claude/` directory.

## Terminal System

### Pipeline

```
Browser (xterm.js) ←→ WebSocket ←→ terminal-server.js ←→ node-pty (shell)
```

1. Client opens a WebSocket to `:3458` with query params (cols, rows, shell command, working directory).
2. `terminal-server.js` spawns a `node-pty` process with the requested shell/agent.
3. Bidirectional streaming: keystrokes flow in, terminal output flows out.
4. On disconnect, the PTY is killed after a grace period.

### Terminal Tokens

In authenticated modes, the terminal server requires a **terminal token** — an HMAC-SHA256 signed payload containing the username, role, and expiration. The secret is stored at `~/.spaces/terminal_secret` (auto-generated, 600 permissions).

The Next.js API route `/api/network/terminal/token` issues these tokens (delegated to `@spaces/pro` in paid tiers).

### TOTP Gating

When TOTP 2FA is enabled, the client-side `<TOTPGate>` component intercepts the UI until the user enters a valid code. The component checks `/api/auth/totp/status` and verifies via `/api/auth/totp/verify`.

## Authentication

### Session Tokens (Server/Team/Federation)

`@spaces/pro` implements cookie-based session auth:

1. User POSTs credentials to `/api/auth/login`.
2. Pro verifies the password hash and issues an HMAC-SHA256 session token.
3. Token is set as `spaces-session` cookie (24h expiry).
4. `middleware.ts` (in the public repo) delegates to `@spaces/pro`'s middleware, which:
   - Verifies the cookie signature.
   - Sets `x-auth-user` and `x-auth-role` headers on the forwarded request.
   - Redirects unauthenticated users to `/login`.

### Why auth.ts Stays Public

`src/lib/auth.ts` provides user context (AsyncLocalStorage), not auth logic. Every API route calls `getAuthUser(request)` and `withUser(user, fn)`. Moving it to pro would break all routes. The actual authentication (password verification, token issuance, middleware enforcement) lives in `@spaces/pro`.

## Federation

### Node Discovery

- **mDNS** (`dns-sd` / Bonjour) — automatic LAN discovery
- **Manual** — add nodes via `/network` UI or API

### API Key Exchange

Nodes authenticate to each other using API keys encrypted with AES-256-GCM. The handshake protocol:

1. Node A calls `POST /api/network/handshake` on Node B with its identity.
2. Node B validates, generates an API key, encrypts it, stores the key, and returns the encrypted key.
3. Node A decrypts and stores. Both nodes can now make authenticated requests.

### Cross-Node Aggregation

Federation routes aggregate data across nodes. For example, federated search hits local SQLite first, then fans out to all connected nodes via the network client, merges results, and returns a unified response.

### Proxy Routing

`/api/network/proxy/[nodeId]/[...path]` proxies arbitrary API requests to remote nodes, attaching the stored API key as a Bearer token.

## @spaces/pro Module Structure

```
src/
  index.ts              # Re-exports: auth, admin, network, middleware
  middleware.ts          # Next.js auth middleware (cookie verification)
  auth/
    index.ts            # Auth module exports
    session.ts          # HMAC-SHA256 session token issuance/verification
    totp.ts             # TOTP 2FA (otpauth + qrcode)
    api/                # API route handlers (login, logout, me, totp/*)
  admin/
    index.ts            # Admin module exports
    db.ts               # Admin SQLite DB (users table, password hashes)
    api/                # API route handlers (users CRUD, analytics)
  network/
    index.ts            # Network module exports
    client.ts           # HTTP client for inter-node communication
    aggregator.ts       # Cross-node data aggregation
    identity.ts         # Node identity (nodeId, nodeName)
    auth.ts             # API key encryption (AES-256-GCM)
    db.ts               # Network SQLite DB (nodes, API keys)
    api/                # 18 API route handlers (nodes, keys, proxy, etc.)
  types/
    network.ts          # Shared TypeScript types
```

## What Moved to Pro vs. What Stayed

### Moved to `@spaces/pro`

| File | Module | Reason |
|------|--------|--------|
| `src/lib/session.ts` | `auth` | Session token issuance (auth logic) |
| `src/lib/totp.ts` | `auth` | TOTP 2FA (auth logic) |
| `src/lib/db/admin.ts` | `admin` | User management DB |
| `src/lib/db/network.ts` | `network` | Network/nodes DB |
| `src/lib/network/client.ts` | `network` | Inter-node HTTP client |
| `src/lib/network/aggregator.ts` | `network` | Cross-node aggregation |
| `src/lib/network/identity.ts` | `network` | Node identity management |
| `src/lib/network/auth.ts` | `network` | API key encryption |

### Stayed Public

| File | Reason |
|------|--------|
| `src/lib/auth.ts` | User context (AsyncLocalStorage), not auth logic. Used by every route. |
| `src/lib/config.ts` | Path resolution, cost rates. Community needs these. |
| `src/lib/tier.ts` | Tier resolution. Must run before pro is loaded. |
| `src/lib/pro.ts` | Bridge to load pro. Must exist in public repo. |
| `src/lib/license.ts` | License verification. Contains only the public key. |
| All pages (`src/app/`) | Next.js can't resolve `@/` imports from an npm package. |
| Client components | Only call API routes (which stub to pro). No server logic. |

### Key Decisions

- **Pages can't move** — Next.js App Router requires pages in the app directory with `@/` path aliases. An npm package can't use the host app's path aliases.
- **Client-side network components stay** — Components like the network UI only call API routes. The routes themselves stub to pro. Moving the UI would be unnecessary complexity.
- **Analytics page is community-tier** — It was previously gated behind auth, but it shows the user's own data. Fixed to be available in all tiers.
- **`IS_DESKTOP` naming** — Really means "personal/local mode" since Community now runs in the browser too. Left as-is to avoid a large rename.
- **Server tier value** — Web access is now free in Community. Server's main differentiator is auth/login, which may be thin. Left as 4 tiers for now; could collapse to 3 later.

## Development Workflow

### Running Both Repos

```bash
# Terminal 1: Build and watch @spaces/pro
cd spaces-pro
npm install
npm run dev          # tsc --watch

# Terminal 2: Link pro into spaces
cd spaces
npm link ../spaces-pro

# Terminal 3: Run spaces
npm run dev           # Next.js on :3457

# Terminal 4: Run terminal server
node bin/terminal-server.js   # WebSocket on :3458
```

### Building Per Tier

```bash
npm run build:community     # No pro needed
npm run build:server        # Requires @spaces/pro linked/installed
npm run build:team          # Requires @spaces/pro
npm run build:federation    # Requires @spaces/pro
```

## Debugging

### Auth Flow

1. Check `NEXT_PUBLIC_TIER` — if `community`, auth is skipped entirely.
2. Verify `@spaces/pro` is installed: `node -e "require('@spaces/pro')"`.
3. Check `~/.spaces/session_secret` exists (auto-created on first login).
4. Inspect the `spaces-session` cookie in browser DevTools.
5. Look for `x-auth-user` / `x-auth-role` headers in API responses.

### Terminal Connection

1. Verify terminal server is running on `:3458`.
2. Check `~/.spaces/terminal_secret` exists.
3. In authenticated mode, verify terminal token is being issued (check network tab for `/api/network/terminal/token`).
4. Check browser console for WebSocket connection errors.

### Federation

1. Both nodes must have completed the handshake (`POST /api/network/handshake`).
2. Check `~/.spaces/node.json` exists on both nodes.
3. Verify API keys are stored in the network DB.
4. Test with `curl -H "Authorization: Bearer <key>" https://node-b/api/network/health`.
5. For mDNS, ensure `SPACES_TIER=federation` is set on the terminal server.

## Deployment

### Docker

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build:federation
ENV NEXT_PUBLIC_TIER=federation
ENV SPACES_TIER=federation
EXPOSE 3457 3458
CMD ["node", "bin/spaces.js"]
```

### Nginx Reverse Proxy

```nginx
server {
    listen 443 ssl;
    server_name spaces.example.com;

    location / {
        proxy_pass http://127.0.0.1:3457;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3458;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Standalone

```bash
npm run build:federation
NEXT_PUBLIC_TIER=federation SPACES_TIER=federation node bin/spaces.js
```

`bin/spaces.js` launches both the Next.js server and the terminal server in a single process.

## Mobile

Routes under `/m/` provide a mobile-optimized layout. The middleware auto-redirects mobile user-agents to `/m/`. Features:

- Responsive terminal grid (single pane focus)
- Voice input (Web Speech API)
- Touch-friendly session browser
- Settings at `/m/settings`
