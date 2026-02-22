# Spaces

A workspace manager for AI coding agents. Run Claude Code, Codex CLI, Gemini CLI, Aider, or any custom agent side-by-side in a browser-based or desktop terminal grid.

## Product Tiers

Spaces follows an **open-core** model. The Community tier is fully open source and free. Server, Team, and Federation tiers require the private `@spaces/pro` package.

| | Community | Server | Team | Federation |
|---|-----------|--------|------|------------|
| **Target** | Solo dev | Solo dev, remote | Dev teams | Orgs / networks |
| Multi-pane terminals | Yes | Yes | Yes | Yes |
| Session browser & search | Yes | Yes | Yes | Yes |
| Dashboard & analytics | Yes | Yes | Yes | Yes |
| Electron desktop app | Yes | - | - | - |
| Browser access | Yes | Yes | Yes | Yes |
| Login & TOTP auth | - | Yes | Yes | Yes |
| Multi-user accounts | - | - | Yes | Yes |
| Admin panel | - | - | Yes | Yes |
| Network / Nodes | - | - | - | Yes |
| Remote workspaces | - | - | - | Yes |
| mDNS discovery | - | - | - | Yes |

See [docs/tiers.md](docs/tiers.md) for details.

## Quick Start (Community)

```bash
git clone https://github.com/jlongo78/spaces.git
cd spaces
npm install
npm run dev                    # Next.js dev server on :3457
node bin/terminal-server.js    # Terminal WebSocket server on :3458
```

Open [http://localhost:3457](http://localhost:3457).

For other tiers, see [docs/getting-started.md](docs/getting-started.md).

## Features

**Terminal multiplexer** — Split your browser into a grid of terminal panes. Each pane runs a real PTY (via node-pty) streamed over WebSocket to xterm.js.

**Agent-agnostic** — First-class support for Claude Code, Codex CLI, Gemini CLI, Aider, custom commands, and plain shell.

**Workspaces** — Group panes into named, color-coded spaces. Switch between them instantly.

**Session browser** — Browse, search, and filter all your Claude Code sessions with full-text search (SQLite FTS5).

**Dashboard & analytics** — Session counts, model usage breakdown, activity heatmap, and cost estimates.

**Everything local** — All data stays on your machine. `~/.claude/` is read-only.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_TIER` | `community` | Product tier (`community` / `server` / `team` / `federation`) |
| `SPACES_TIER` | `federation` | Terminal server tier (gates mDNS and proxy) |
| `SPACES_PORT` | `3457` | Web UI port |
| `SPACES_WS_PORT` | `3458` | Terminal WebSocket port |
| `NEXT_PUBLIC_EDITION` | - | Legacy. `server` maps to `federation` |

Data directories:
- `~/.claude/` — Claude Code sessions (read-only)
- `~/.spaces/spaces.db` — Spaces database (auto-created)

## Project Structure

```
src/
  app/                    # Next.js pages + API routes
  components/             # React components
  lib/
    tier.ts               # Tier definitions and feature flags
    pro.ts                # Extension bridge to @spaces/pro
    license.ts            # Ed25519 license verification
    auth.ts               # User context (AsyncLocalStorage)
    config.ts             # Paths and configuration
    db/                   # SQLite schema and queries
bin/
  terminal-server.js      # WebSocket PTY server
  spaces.js               # Production launcher
docs/
  tiers.md                # Tier comparison
  getting-started.md      # Installation per tier
  architecture.md         # Developer guide
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js (App Router) |
| UI | Tailwind CSS + Lucide icons |
| Database | SQLite (better-sqlite3) with FTS5 |
| Terminal | xterm.js + node-pty + ws |
| Desktop | Electron |

## Build Commands

```bash
npm run build:community    # Desktop / Electron
npm run build:server       # Single-user server
npm run build:team         # Multi-user server
npm run build:federation   # Full features + networking
```

## License

MIT
