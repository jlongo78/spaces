# Spaces

A local workspace manager for AI coding agents. Run Claude Code, Codex CLI, Gemini CLI, Aider, or any custom agent side-by-side in a browser-based terminal grid.

Spaces reads your `~/.claude/` directory to index past sessions, and provides a multiplexed terminal UI where you can launch, resume, and organize agent sessions across spaces.

## Features

**Terminal multiplexer** - Split your browser into a grid of terminal panes. Each pane runs a real PTY (via node-pty) streamed over WebSocket to xterm.js. Resize, maximize, pop out to a separate window, or snap back.

**Agent-agnostic** - First-class support for:
- **Claude Code** - launch new sessions or resume existing ones (auto-detects session ID)
- **Codex CLI** (OpenAI)
- **Gemini CLI** (Google)
- **Aider**
- **Custom commands** - run any CLI tool
- **Plain shell**

**Spaces** - Group panes into named, color-coded spaces. Switch between them instantly. Pop-out windows remember their position and size, close when you switch, and restore when you switch back.

**Session browser** - Browse, search, and filter all your Claude Code sessions. Full-text search (SQLite FTS5) across message content. View conversations with rendered markdown, syntax-highlighted code blocks, collapsible thinking blocks, and tool-use cards.

**Dashboard & analytics** - Session counts, message totals, model usage breakdown, activity heatmap, cost estimates, and recent session list.

**Everything local** - All data stays on your machine. `~/.claude/` is read-only (never modified). Spaces stores its own metadata (layouts, tags, stars) in `~/.spaces/spaces.db`.

## Quick Start

### Prerequisites

- **Node.js 20+**
- At least one AI coding agent installed (e.g. `claude`, `codex`, `gemini`, `aider`)

### Install & Run

```bash
git clone https://github.com/arc-robindale/spaces.git
cd spaces
npm install
npm run build
```

Start both the web UI and terminal server:

```bash
# Terminal 1 - terminal server (PTY backend)
node bin/terminal-server.js

# Terminal 2 - web UI
npm run dev
```

Open [http://localhost:3457](http://localhost:3457).

### Development

```bash
npm run dev                    # Next.js dev server on :3457
node bin/terminal-server.js    # Terminal WebSocket server on :3458
```

## How It Works

```
Browser (localhost:3457)
    |
    |  HTTP (pages + API)
    |  WebSocket (terminal I/O)
    |
Next.js + Terminal Server
    |
    |-- Reads: ~/.claude/        (read-only, session transcripts)
    |-- Owns:  ~/.spaces/        (SQLite DB, config)
    |-- Spawns: node-pty         (one PTY per terminal pane)
```

When you open a pane, the terminal server spawns a PTY process and bridges it to the browser over WebSocket. For agent panes, it injects the appropriate CLI command (e.g. `claude`, `claude --resume <id>`, `codex`, etc.) into the shell.

Claude Code sessions are auto-detected: when you start a new Claude pane, Spaces watches `~/.claude/projects/` for the new session file and persists the session ID so subsequent page loads resume instead of creating a new session.

## Project Structure

```
src/
  app/                    # Next.js pages + API routes
    terminal/             # Spaces - the main terminal grid UI
    sessions/             # Session browser + viewer
    analytics/            # Usage charts and stats
    projects/             # Project list
    settings/             # Configuration
    api/                  # REST API endpoints
  components/
    terminal/             # Terminal pane (xterm.js)
    sessions/             # Session list, filters
    viewer/               # Message renderer (markdown, code, tools)
    dashboard/            # Stats cards, charts
    layout/               # Sidebar, providers
    common/               # Color picker, folder picker, tags
  lib/
    agents.ts             # Agent type definitions
    db/                   # SQLite schema, queries, init
    claude/               # JSONL parser, session types
    sync/                 # File indexer, watcher
    config.ts             # Paths and configuration
bin/
  terminal-server.js      # WebSocket PTY server
  spaces.js               # Launcher script
```

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) |
| UI | Tailwind CSS + Lucide icons |
| Database | SQLite (better-sqlite3) with FTS5 |
| Terminal | xterm.js + node-pty + ws |
| Charts | Recharts |
| Data fetching | TanStack Query |
| File watching | chokidar |
| Markdown | react-markdown + remark-gfm + rehype-highlight |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SPACES_PORT` | `3457` | Web UI port |
| `SPACES_WS_PORT` | `3458` | Terminal WebSocket port |

Data directories:
- `~/.claude/` - Claude Code sessions (read-only)
- `~/.spaces/spaces.db` - Spaces database (auto-created)

## License

MIT
