# Getting Started

## Prerequisites

- **Node.js 20+** (with npm 9+)
- At least one AI coding agent installed (`claude`, `codex`, `gemini`, `aider`)

## Community (Desktop or Browser)

The Community tier runs locally with no authentication required.

```bash
git clone https://github.com/jlongo78/spaces.git
cd spaces
npm install
npm run build
npm start
```

Open [http://localhost:3457](http://localhost:3457).

## Server, Team, and Federation

These tiers require the private `@spaces/pro` package. Contact the team for access.

### Installing @spaces/pro

**Option A — npm link (local development):**

```bash
# Build the pro package
cd spaces-pro
npm install
npm run build

# Link it into the main repo
cd ../spaces
npm link ../spaces-pro
```

**Option B — private registry:**

If you have access to a private npm registry:

```bash
npm install @spaces/pro --registry https://your-registry.example.com
```

### Server (Single-User)

Deploy as a standalone web server for browser access:

```bash
npm run build:server
NEXT_PUBLIC_TIER=server node bin/spaces.js
```

Set up authentication:

```bash
npm run setup-admin
```

### Team (Multi-User)

Same as Server, but with multi-user support:

```bash
npm run build:team
NEXT_PUBLIC_TIER=team SPACES_TIER=team node bin/spaces.js
```

Create additional users via the admin panel at `/admin/users`.

### Federation (Network)

Full feature set including cross-node networking:

```bash
npm run build:federation
NEXT_PUBLIC_TIER=federation SPACES_TIER=federation node bin/spaces.js
```

Configure network nodes at `/network`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_TIER` | `community` | Product tier (`community`, `server`, `team`, `federation`) |
| `NEXT_PUBLIC_EDITION` | - | Legacy flag. `server` maps to `federation` tier |
| `SPACES_PORT` | `3457` | Web UI port |
| `SPACES_WS_PORT` | `3458` | Terminal WebSocket port |
| `SPACES_TIER` | `community` | Terminal server tier (gates mDNS and proxy) |
| `SPACES_SESSION_SECRET` | - | Session signing secret (auto-generated) |
| `SPACES_LICENSE` | - | Ed25519-signed JWT license key (optional) |
