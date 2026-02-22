# Spaces Product Tiers

Spaces follows an **open-core** model:

- **Community** is fully open source (MIT) and free.
- **Server**, **Team**, and **Federation** require the private `@spaces/pro` package.

The tier is controlled by the `NEXT_PUBLIC_TIER` environment variable, but paid tiers are gated on `@spaces/pro` being installed. If the env var is set to a paid tier but `@spaces/pro` is missing, Spaces falls back to Community with a console warning.

## Tier Comparison

| Feature | Community | Server | Team | Federation |
|---------|-----------|--------|------|------------|
| Multi-pane terminals | Yes | Yes | Yes | Yes |
| Session browser & search | Yes | Yes | Yes | Yes |
| Dashboard & analytics | Yes | Yes | Yes | Yes |
| All agent types | Yes | Yes | Yes | Yes |
| Electron desktop app | Yes | - | - | - |
| Browser access | Yes | Yes | Yes | Yes |
| Login & TOTP auth | - | Yes | Yes | Yes |
| Multi-user accounts | - | - | Yes | Yes |
| Admin panel (Users) | - | - | Yes | Yes |
| Usage analytics (admin) | - | - | Yes | Yes |
| Network / Nodes | - | - | - | Yes |
| Remote workspaces | - | - | - | Yes |
| mDNS discovery | - | - | - | Yes |

## Choosing a Tier

### Community
**Target:** Solo developer, local machine.
**Tagline:** *AI agent workspaces on your machine. Open source, forever free.*

Use Community when you want a local workspace — either as the Electron desktop app or in a browser via `npm run dev`. Everything runs locally, no login required. No `@spaces/pro` dependency.

### Server
**Target:** Solo developer, remote access.
**Tagline:** *Your Spaces, anywhere. Self-hosted web access from any browser.*
**Requires:** `@spaces/pro`

Use Server when you want to access Spaces from a browser on a remote machine. Includes login authentication and TOTP but supports only a single user.

### Team
**Target:** Developer teams.
**Tagline:** *One server, every developer. Shared workspaces with user management.*
**Requires:** `@spaces/pro`

Use Team when multiple developers share a single Spaces server. Includes multi-user accounts, an admin panel, and usage analytics.

### Federation
**Target:** Organizations and networks.
**Tagline:** *Connect every machine. Unified workspaces across your entire network.*
**Requires:** `@spaces/pro`

Use Federation when you need to connect multiple Spaces servers. Includes everything in Team plus network node management, remote workspace proxying, and mDNS auto-discovery.

## Tier Gating Mechanism

The tier system is implemented in `src/lib/tier.ts`. On startup it:

1. Reads `NEXT_PUBLIC_TIER` (or the legacy `NEXT_PUBLIC_EDITION` fallback).
2. If a `SPACES_LICENSE` JWT is present, verifies it with an Ed25519 public key (`src/lib/license.ts`).
3. Checks whether `@spaces/pro` is installed via `src/lib/pro.ts`.
4. If a paid tier is requested but `@spaces/pro` is not available, falls back to `community`.

Feature flags exported from `tier.ts`:

| Flag | Meaning |
|------|---------|
| `IS_SERVER` | Any tier above community |
| `IS_TEAM` | Team or federation |
| `IS_FEDERATION` | Federation only |
| `HAS_AUTH` | Login is required (same as `IS_SERVER`) |
| `HAS_MULTIUSER` | Multiple user accounts (same as `IS_TEAM`) |
| `HAS_ADMIN` | Admin panel available (same as `IS_TEAM`) |
| `HAS_NETWORK` | Federation networking (same as `IS_FEDERATION`) |
| `IS_DESKTOP` | Community tier (note: name is misleading — really means "personal/local mode") |

## Configuration

Set the tier via environment variable:

```bash
# Desktop / browser (Community)
NEXT_PUBLIC_TIER=community

# Single-user server
NEXT_PUBLIC_TIER=server

# Multi-user team server
NEXT_PUBLIC_TIER=team

# Federated network
NEXT_PUBLIC_TIER=federation
```

The terminal server also accepts `SPACES_TIER` for gating mDNS and proxy features:

```bash
SPACES_TIER=federation node bin/terminal-server.js
```

### Backward Compatibility

If `NEXT_PUBLIC_TIER` is not set but `NEXT_PUBLIC_EDITION=server` is present, the tier defaults to `federation` (matching the previous behavior where all server features were enabled).
