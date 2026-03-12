# Spaces Cortex — Distributed Intelligence Network

**Date:** 2026-03-12
**Status:** Approved
**Feature Name:** Cortex

## Summary

A persistent, self-building knowledge system for Spaces that continuously ingests all AI agent conversations, extracts decisions, patterns, preferences, and error resolutions, stores them as vector embeddings in LanceDB, and automatically injects relevant context into every prompt via hooks. Agents get smarter over time because the Cortex remembers everything you've built, decided, and corrected — across all sessions, all agents, all projects.

In federated environments, Cortex nodes actively teach each other — propagating high-confidence knowledge across the network so every node benefits from every other node's experience. The result is a distributed intelligence network that grows smarter with every conversation, on every machine, across every team.

The Cortex operates across four knowledge layers (Personal, Workspace, Team, Federation), supports all agent types (Claude Code, Codex, Gemini, Aider), and integrates with Spaces' existing tier model (Community, Pro/Server, Teams, Federation).

## Design Principles

- **Zero config** — Cortex works the moment it's enabled. No API keys required (falls back to local embeddings). No manual curation needed.
- **Fully automatic** — All conversations are ingested passively. The Cortex decides what's worth remembering. Users never need to manually save knowledge.
- **Invisible when working, inspectable when curious** — The Cortex enhances every prompt silently. But every injection is visible (pane header badge), every knowledge unit is browsable (Cortex panel), and everything can be taught, corrected, or forgotten.
- **Privacy by default** — Personal knowledge never leaves your node. Workspace knowledge is shareable only if the workspace is collaborative. Team knowledge flows only between paired federation nodes.
- **Distributed intelligence** — In federated environments, Cortex nodes actively teach each other. High-confidence knowledge propagates across the network automatically. Every node makes every other node smarter.

## Architecture

### System Overview

```
Input (Conversation Stream)
  │  Claude Code JSONL, Codex, Gemini, Aider sessions, terminal output
  ▼
Ingestion Pipeline
  │  Tier 1: Fast Pass (heuristic, ~10ms) → immediate chunks
  │  Tier 2: Embedding (~50ms) → vectorize and store in LanceDB
  │  Tier 3: Distillation (async) → LLM extracts decisions, patterns, preferences
  ▼
Storage (LanceDB)
  │  Personal layer: ~/.spaces/cortex/personal/
  │  Workspace layer: ~/.spaces/cortex/workspace/{id}/
  │  Team layer: ~/.spaces/cortex/team/ (cache from federation queries)
  ▼
Retrieval & Injection
  │  Hook injection: automatic, every prompt, <200ms
  │  MCP tool: agent-driven deep queries
  │  Federation query: transparent delegation to remote nodes
  ▼
Agent receives prompt + relevant Cortex context
```

### Knowledge Layers

Four layers, organized from most specific to most general:

| Layer | Scope | Privacy | Storage | Examples |
|-------|-------|---------|---------|----------|
| **Personal** | Your preferences and style | Never shared | `~/.spaces/cortex/personal/` | "Prefers Zod", "No ORMs", "Terse output" |
| **Workspace** | Project-specific knowledge | Shareable if workspace is collaborative | `~/.spaces/cortex/workspace/{id}/` | "Auth uses JWT", "DB schema v3", "Bug #247 fix" |
| **Team** | Shared conventions | Flows between federation nodes | `~/.spaces/cortex/team/` (local cache) | "API uses /v2/ prefix", "All endpoints return {data, error}" |
| **Federation** | Org-wide patterns | Query delegation across nodes | Not stored locally — queried on demand | Cross-team patterns, org standards |

On every prompt, the Cortex searches: Personal → Workspace → Team → Federation. Most specific wins. Results merged by relevance score.

## Ingestion Pipeline

### Tier 1: Fast Pass (immediate, heuristic)

Runs synchronously as messages are indexed. No LLM calls, no API calls. Pure text processing at ~10ms per message.

**Extractors:**

- **Message chunking** — Split conversations into semantic chunks at turn boundaries, topic shifts, and tool call boundaries. Each chunk gets metadata: session ID, workspace ID, agent type, timestamp, project path.
- **Code block extraction** — Pull fenced code blocks as separate chunks. Tag with language, file path (from nearby context), and whether user-provided or agent-generated.
- **File reference detection** — Regex scan for file paths. Links chunks to the files they discuss.
- **Error/fix pair detection** — Detect "error → investigation → fix" patterns. Heuristic: error messages followed by successful resolution within the same session.
- **Command extraction** — Terminal commands with context: what was run, why, what happened.
- **Conversation summary markers** — When a session ends or reaches a natural break, generate a session-level summary chunk capturing the overall arc.
- **Git context linking** — Capture git branch, commit hashes, and diff stats. Links knowledge to exact code state.
- **Tool call analysis** — Parse tool_use/tool_result pairs. File reads = what code was examined. Edits = what changed and why. Bash commands = what was tested.

### Tier 2: Embedding (near-realtime)

Runs async but fast. Vectorizes chunks from Tier 1:

- **Model selection** — Check for API keys in order: Voyage AI → OpenAI → Anthropic → local (all-MiniLM-L6-v2 via ONNX Runtime). Best available wins. Default to most advanced available.
- **Batch embedding** — Queue chunks, embed in batches (50-100 per API call).
- **LanceDB storage** — Store vector with full metadata (see schema below).
- **Deduplication** — Check cosine similarity against recent entries. >0.95 similarity = skip.

### Tier 3: Distillation (background, LLM-powered)

Runs during idle time. Produces high-quality knowledge units from raw chunks:

- **Decision extraction** — "We decided to use X because Y." Structured: decision, rationale, alternatives considered, date.
- **Pattern recognition** — "This project always does X when Y." Recurring approaches across sessions.
- **Preference learning** — "User corrected: don't do X, do Y instead." Corrections become personal-layer knowledge.
- **Error wisdom** — "When error X happens, the fix is Y." Distilled from error/fix pairs.
- **Staleness scoring** — Each unit gets a freshness score based on source file modification times.

The distiller uses whatever LLM is available (Claude API, or delegates to a running Claude Code session). Processes batches of recent chunks, produces structured knowledge units, embeds them, stores with `type: 'distilled'` and higher base confidence.

### Bootstrap Ingestion

On first enable (or when linking a new workspace to a project), bulk-processes all existing sessions:

1. Scan `~/.claude/projects/`, `~/.codex/`, `~/.gemini/`, `.aider.chat.history.md` for all existing sessions
2. Map sessions to workspaces by project path
3. Run Tier 1 (fast pass) on all messages
4. Run Tier 2 (embedding) in batches
5. Queue Tier 3 (distillation) starting from most recent, working backward
6. Ingest subagent transcripts (full conversations in `{sessionId}/subagents/`)
7. Show progress in UI: "Ingesting 172MB across 20 projects... 45%"

Bootstrap is incremental — if interrupted, picks up where it left off using sync state tracking.

## Knowledge Classification

### Knowledge Unit Types

| Type | Source | Confidence Base | Staleness Half-life | Example |
|------|--------|-----------------|---------------------|---------|
| `decision` | Distillation | 0.8 | 180 days | "Using JWT with refresh rotation for auth" |
| `pattern` | Distillation + repetition | 0.8 | 90 days | "API routes validate with Zod middleware" |
| `preference` | User corrections | 0.95 | 180 days | "Don't mock DB in integration tests" |
| `error_fix` | Error/fix detection | 0.8 | 90 days | "ECONNRESET → exponential backoff with jitter" |
| `context` | Session summaries | 0.6 | 30 days | "Migrating from v1 to v2 API" |
| `code_pattern` | Code block analysis | 0.7 | 60 days | "Components use forwardRef + displayName" |
| `command` | Command extraction | 0.6 | 30 days | "Deploy: npm run deploy:staging" |
| `conversation` | Raw chunking | 0.4 | 14 days | Fallback: raw conversation segment |
| `summary` | Session summarization | 0.6 | 60 days | "Session built the Cortex ingestion pipeline" |

### Storage Schema (LanceDB)

```
Table: knowledge
├── id: string (uuid)
├── vector: float32[dimensions]
├── text: string
├── type: string                     // decision/pattern/preference/error_fix/context/code_pattern/command/conversation/summary
├── layer: string                    // personal/workspace/team
├── workspace_id: number | null
├── session_id: string | null
├── agent_type: string               // claude/codex/gemini/aider
├── project_path: string | null
├── file_refs: string[]
├── confidence: float32              // 0.0–1.0
├── created: timestamp
├── source_timestamp: timestamp
├── stale_score: float32             // 0.0–1.0
├── access_count: number
├── last_accessed: timestamp | null
└── metadata: json
```

### Confidence Scoring

- **Source quality:** Distilled = 0.8 base, raw chunks = 0.4
- **Repetition:** Same pattern across 3+ sessions → +0.1 per occurrence (cap 0.95)
- **Recency:** Last 7 days → +0.1 boost
- **User validation:** Explicit `cortex_teach` → 0.95
- **Contradiction:** Newer knowledge contradicts older → older gets confidence reduced, gains `superseded_by` pointer

### Staleness Detection

- **File modification tracking** — Referenced files heavily modified since knowledge created → increase `stale_score`
- **Git-aware** — Referenced branch merged or deleted → mark potentially stale
- **Contradiction from newer sessions** — Recent session shows different approach → downrank older
- **Time decay** — Configurable half-lives per knowledge type (see table above)

**Effective retrieval score:** `similarity × confidence × (1 - stale_score) × recency_boost`

## Retrieval & Injection

### Path 1: Hook Injection (automatic, every prompt)

Target latency: <200ms.

1. **Extract query signal** — Parse prompt for intent, keywords, file paths, error messages, concept terms
2. **Multi-layer search** — Query LanceDB across layers with priority weighting:
   - Personal (weight 1.0)
   - Active workspace (weight 0.9)
   - Other workspaces (weight 0.5, if relevant)
   - Team via federation (weight 0.7, if available)
3. **Reranking** — Score by: vector similarity, recency, confidence, source quality, staleness. Take top-k (default: 5).
4. **Token budget** — Cap at ~2000 tokens (configurable). Summarize or truncate lower-ranked results if over budget.
5. **Inject** — Append `<cortex-context>` block to prompt:

```
<cortex-context>
Relevant context from your workspace history:

[Decision] 2026-03-10: Auth uses JWT with httpOnly cookies, refresh token rotation.
Source: session abc123, workspace "Backend API"

[Pattern] This project uses Zod schemas at API boundaries, validated in middleware.
Source: 4 sessions over 2 weeks, confidence: 0.92

[Error Fix] "ECONNRESET on WebSocket reconnect" — Fixed by adding exponential backoff
with jitter in the reconnect handler. See session def456.

[Preference] You previously corrected: "Don't mock the database in integration tests."
</cortex-context>
```

For Claude Code: uses the `user-prompt-submit` hook.

For other agents (Codex, Gemini, Aider): terminal intercept approach — watches PTY input stream and injects context via wrapper script that prepends cortex context to stdin.

### Path 2: MCP Tool (agent-driven, on-demand)

The Cortex exposes an MCP server with these tools:

| Tool | Purpose | Key Params |
|------|---------|------------|
| `cortex_search` | Semantic search across layers | query, layers, types, workspace_id, time_range, min_confidence, limit |
| `cortex_recall` | Retrieve specific unit by ID or exact match | id, exact |
| `cortex_context` | Full context for a workspace | workspace_id, depth (brief/full) |
| `cortex_similar` | Find analogous past experiences | input, type (error/code/problem), limit |
| `cortex_timeline` | Chronological decision/change history | workspace_id, project_path, limit |
| `cortex_teach` | Explicitly store knowledge (confidence 0.95) | text, type, layer, workspace_id |
| `cortex_forget` | Remove or downrank knowledge | id, query, action (delete/downrank) |
| `cortex_status` | Cortex health and stats | — |
| `cortex_export` | Export cortex to .cortexpack | scope, workspace_id, include_embeddings, format |
| `cortex_import` | Import .cortexpack archive | path, target_layer, merge_strategy, re_embed |

### Path 3: Federation Query (transparent)

When team-layer results are needed:

1. Local Cortex constructs search request (query embedding + filters)
2. Request goes to `GET /api/network/proxy/{nodeId}/api/cortex/search`
3. Remote node runs search locally, returns results
4. Local Cortex merges remote results with local by relevance score
5. All connected nodes queried in parallel, configurable timeout (default 500ms)

## Federation

### Three Sync Modes (per-node-pair setting)

| Mode | Behavior | Best For |
|------|----------|----------|
| **Query-only** (default) | No data replication. Query remote nodes on demand. | Privacy-conscious teams, intermittent connectivity |
| **Background sync** | Periodically pull team-layer knowledge and cache locally. Fall back to live query if cache stale. | Better latency, offline capability |
| **Real-time sync** | Continuous replication via WebSocket. Knowledge appears on all nodes within seconds. | Tight teams, same codebase, full trust |

Background sync: polls connected nodes every N minutes (default 5), imports new knowledge units using merge-by-similarity.

Real-time sync: persistent WebSocket to `/api/cortex/federation/stream`. New team-layer units pushed as created.

### Privacy Model

- **Personal layer** — Never leaves your node. Not queryable by remote nodes.
- **Workspace layer** — Queryable by remote nodes only if the workspace has `collaboration: true`.
- **Team layer** — Always queryable by paired federation nodes. This is the shared knowledge pool.

## Import/Export (Portable Knowledge)

### .cortexpack Format

```
my-project.cortexpack (tar.gz)
├── manifest.json          — version, source node, export date, stats
├── knowledge.jsonl        — knowledge units as JSON lines
├── embeddings.lance/      — LanceDB table snapshot (optional, large)
└── sessions.json          — source session metadata for provenance
```

Without embeddings: ~5-50MB typical. With embeddings: larger but skips re-embedding on import.

### Export Options

- **Scope:** full, workspace, personal, or custom (filtered by type/time)
- **Include embeddings:** optional (skip re-embedding on import vs. smaller file)

### Import Options

- **Target layer:** where to put imported knowledge
- **Merge strategy:** append (add all), merge (deduplicate by similarity, keep highest confidence), replace (wipe then import)
- **Re-embed:** regenerate embeddings with local model if embeddings not included

### Use Cases

- **Cloud ↔ Local sync** — Export from cloud VM, import locally (or vice versa)
- **Onboarding** — Senior dev exports workspace cortex, new team member imports. Instant ramp-up.
- **Project handoff** — Export cortex with codebase. Next developer gets the reasoning, not just the code.
- **Backup/restore** — Periodic export as backup
- **Machine migration** — Moving to new laptop? Export all cortexes, import on new machine.

## REST API

```
# Cortex status and health
GET    /api/cortex/status

# Knowledge CRUD
GET    /api/cortex/search?q=...&layer=...&type=...
GET    /api/cortex/knowledge/:id
POST   /api/cortex/knowledge          — create (cortex_teach)
PATCH  /api/cortex/knowledge/:id      — update confidence/layer/metadata
DELETE /api/cortex/knowledge/:id      — remove (cortex_forget)

# Workspace context
GET    /api/cortex/workspace/:id/context
GET    /api/cortex/timeline?workspace_id=...

# Bootstrap
POST   /api/cortex/ingest/bootstrap
GET    /api/cortex/ingest/status

# Import/Export
POST   /api/cortex/export             — body: {scope, workspace_id?, include_embeddings?}
POST   /api/cortex/import             — multipart .cortexpack upload
GET    /api/cortex/import/status

# Settings
GET    /api/cortex/settings
POST   /api/cortex/settings

# Federation (served to remote nodes)
GET    /api/cortex/federation/search  — remote search endpoint
WS     /api/cortex/federation/stream  — real-time sync WebSocket

# Active Knowledge Propagation
POST   /api/cortex/federation/teach     — receive propagated knowledge from remote node
GET    /api/cortex/federation/pending   — knowledge pending review (contradictions)
POST   /api/cortex/federation/resolve   — resolve contradiction
```

## UI Integration

### 1. Top Bar — CortexStatus Indicator

Small purple "Cortex" badge in the top bar, always visible. Shows knowledge unit count. Pulses gently during active ingestion or retrieval. Colors: green (healthy), amber (ingesting), red (error). Click to open Cortex panel.

### 2. CortexPanel — Slide-out Knowledge Explorer

Opens from the right when Cortex indicator is clicked:

- **Search bar** — Semantic search across all knowledge
- **Stats row** — Total units, distilled count, average confidence
- **Layer tabs** — Personal / Workspace / Team
- **Knowledge list** — Each unit shows: type badge (color-coded), text, confidence, source, age
- **Actions** — Teach Cortex, Export, Settings

Knowledge type colors:
- Decision: blue (#60a5fa)
- Preference: pink (#f472b6)
- Pattern: green (#34d399)
- Error Fix: amber (#fbbf24)
- Context: gray (#94a3b8)

### 3. Pane Header — CortexActivity Badge

Each terminal pane header shows a small badge when the Cortex injected context into the last prompt: "3 items" with a purple dot. Click to see exactly what context was provided. Builds trust through transparency.

### 4. Settings Page — CortexConfiguration

Settings → Cortex section:
- Enable/disable toggle
- Embedding provider (auto-detected, with override)
- Injection token budget (default 2000)
- LLM distillation toggle
- Federation sync mode dropdown (Query Only / Background Sync / Real-time Sync)
- Bootstrap ingestion trigger with progress bar

## Configuration Defaults

```json
{
  "enabled": true,
  "embedding": {
    "provider": "auto",
    "model": null,
    "fallback": "local"
  },
  "injection": {
    "enabled": true,
    "max_tokens": 2000,
    "max_results": 5,
    "min_confidence": 0.3
  },
  "ingestion": {
    "auto_ingest": true,
    "distillation": true,
    "distillation_model": "auto"
  },
  "layers": {
    "personal": true,
    "workspace": true,
    "team": true
  },
  "staleness": {
    "decision_halflife_days": 180,
    "pattern_halflife_days": 90,
    "context_halflife_days": 30,
    "conversation_halflife_days": 14
  },
  "federation": {
    "sync_mode": "query-only",
    "sync_interval_minutes": 5,
    "query_timeout_ms": 500
  }
}
```

## File Structure

```
src/lib/cortex/
├── index.ts                 — Cortex singleton, initialization
├── config.ts                — Cortex settings management
├── store.ts                 — LanceDB connection, table management
├── embeddings/
│   ├── index.ts             — Embedding provider router
│   ├── voyage.ts            — Voyage AI provider
│   ├── openai.ts            — OpenAI provider
│   ├── anthropic.ts         — Anthropic provider
│   └── local.ts             — ONNX Runtime local provider
├── ingestion/
│   ├── pipeline.ts          — Ingestion pipeline orchestrator
│   ├── chunker.ts           — Message chunking logic
│   ├── extractors.ts        — Code blocks, file refs, errors, commands, git context, tool calls
│   ├── deduplicator.ts      — Cosine similarity dedup
│   ├── bootstrap.ts         — Historical session bulk ingestion
│   └── watcher.ts           — Live file watcher for new messages
├── distillation/
│   ├── distiller.ts         — Background LLM knowledge extraction
│   ├── prompts.ts           — Distillation prompt templates
│   └── scheduler.ts         — Idle-time scheduling
├── retrieval/
│   ├── search.ts            — Multi-layer vector search with reranking
│   ├── injection.ts         — Prompt augmentation (cortex-context block)
│   ├── federation.ts        — Remote node query delegation
│   └── scoring.ts           — Confidence, staleness, relevance scoring
├── knowledge/
│   ├── types.ts             — Knowledge unit type definitions
│   ├── staleness.ts         — Staleness detection and decay
│   └── contradiction.ts     — Contradiction detection between units
├── portability/
│   ├── exporter.ts          — .cortexpack export
│   └── importer.ts          — .cortexpack import with merge strategies
└── mcp/
    └── server.ts            — MCP server exposing cortex tools

src/app/api/cortex/
├── status/route.ts
├── search/route.ts
├── knowledge/route.ts
├── knowledge/[id]/route.ts
├── workspace/[id]/context/route.ts
├── timeline/route.ts
├── ingest/bootstrap/route.ts
├── ingest/status/route.ts
├── export/route.ts
├── import/route.ts
├── import/status/route.ts
├── settings/route.ts
└── federation/
    ├── search/route.ts
    └── stream/route.ts

src/components/cortex/
├── cortex-indicator.tsx      — Top bar status badge
├── cortex-panel.tsx          — Slide-out knowledge explorer
├── cortex-settings.tsx       — Settings page section
├── knowledge-card.tsx       — Individual knowledge unit display
└── injection-badge.tsx      — Pane header injection indicator

~/.spaces/cortex/
├── config.json              — Cortex settings
├── personal/                — Personal layer LanceDB tables
├── workspace/
│   ├── 1/                   — Workspace 1 LanceDB tables
│   ├── 2/                   — Workspace 2 LanceDB tables
│   └── .../
└── team/                    — Team layer cache (from federation)
```

## Dependencies & Platform Compatibility

### LanceDB

Use `@lancedb/lancedb` (the official Node.js package). This has native Rust bindings for optimal performance, with a WASM fallback for platforms where native compilation fails.

**Installation strategy:**

1. Primary: `@lancedb/lancedb` with native bindings (best performance)
2. Fallback: If native compilation fails during `npm install`, the package provides WASM builds that work everywhere
3. The package supports Windows (MSVC + MINGW), macOS (Intel + Apple Silicon), and Linux (x64 + ARM64)

Since Spaces already depends on `better-sqlite3` (native), users are already set up for native compilation. LanceDB adds ~15MB to the install.

### Local Embedding Model

For the local embedding fallback, use `@xenova/transformers` (Transformers.js) which runs models via ONNX Runtime in Node.js. The `all-MiniLM-L6-v2` model is ~23MB and loads once on first use.

### Embedding Provider Chain

Check for API keys in order: Voyage AI (`VOYAGE_API_KEY`) → OpenAI (`OPENAI_API_KEY`) → local (ONNX). Default to the best available. Anthropic does not offer a public embedding API; Voyage AI is the recommended partner.

### Embedding Dimension Management

Different providers produce different dimensions (MiniLM: 384, OpenAI: 1536, Voyage: 1024). The Cortex stores the current embedding dimension in config. If the user changes providers:

1. Detect dimension mismatch on startup
2. Warn: "Embedding provider changed. Re-embedding all knowledge units in background."
3. Queue full re-embedding as a background job (same as bootstrap, but embedding-only)
4. During transition, old vectors are still searchable (LanceDB handles mixed queries via separate partitions), new results take priority

## Error Handling & Resilience

### Ingestion Pipeline Failures

- **Tier 1 (fast pass):** If a session file is malformed or being actively written to, skip that file and log a warning. Retry on next sync cycle. Never crash the pipeline for a single bad file.
- **Tier 2 (embedding):** If the embedding API returns an error (rate limit, network, invalid response), move the chunk to a retry queue with exponential backoff (1s, 5s, 30s, 5min). After 5 failures, fall back to local embeddings for that batch. If local also fails, store the chunk as text-only (searchable via FTS but not vector search) and log an error.
- **Tier 3 (distillation):** If the LLM call fails or returns malformed output, discard that distillation attempt and log. The raw chunks remain searchable. Retry distillation on next idle cycle. Never block ingestion on distillation failures.

### LanceDB Corruption Recovery

LanceDB uses Arrow IPC format. Partial writes can corrupt tables. Recovery strategy:

1. On startup, verify table integrity (LanceDB provides health checks)
2. If corruption detected, log error, rename corrupt directory to `{layer}.corrupt.{timestamp}/`
3. Create fresh empty table
4. Trigger re-ingestion from raw session files (bootstrap in repair mode — embedding-only, no re-parsing)
5. The raw JSONL session files are the source of truth; LanceDB is a derived index

### Graceful Degradation

The Cortex continues to function even when components fail:

| Failure | Behavior |
|---------|----------|
| Embedding API down | Fall back to local embeddings automatically |
| Local embeddings fail | Store text-only chunks, skip vector search, use FTS keyword matching |
| LanceDB unavailable | Cortex indicator shows red, injection disabled, MCP tools return empty results |
| Federation node unreachable | Skip that node's results, merge what's available |
| Distillation LLM unavailable | Raw chunks still searchable, distillation queued for later |
| Bootstrap interrupted | Resume from last checkpoint on next run |

### Circuit Breaker

External API calls (embedding, distillation, federation) use a circuit breaker pattern:

- **Closed** (normal): requests flow through
- **Open** (after 5 consecutive failures): stop calling for 60 seconds, return fallback
- **Half-open** (after cooldown): try one request, if success → close, if fail → reopen

## Non-Claude Agent Injection

Claude Code has hook support (`PreToolUse`, `PostToolUse`, `Notification`, `Stop`). However, Claude Code does not currently support a `user-prompt-submit` hook for intercepting prompts before they're sent.

**Primary injection strategy (all agents): MCP Tool**

The Cortex registers as an MCP server. Claude Code (and any agent that supports MCP) can call `cortex_search` and `cortex_context` as tools. The agent receives cortex context as tool results, which it naturally incorporates.

To make this automatic (without the agent needing to know to ask), the Cortex's MCP server description includes instructions telling the agent to query the Cortex at the start of each task. This is how MCP servers like `memory` work today — the server description says "always check memory first."

**Secondary injection strategy (future): PTY-level injection**

For agents without MCP support, and for the auto-injection experience (user doesn't need to configure anything), a future version could:

1. Intercept at the WebSocket layer in `terminal/server.ts` — when a `data` message from the client matches a prompt pattern (newline after text), inject cortex context
2. This happens before the data reaches node-pty, so the agent sees the enriched prompt
3. This requires careful handling of escape sequences, binary data, and multi-byte characters
4. **Deferred to a future phase** — MCP is the v1 approach

## Integration with Existing Data Layer

### SQLite Cross-References

Cortex knowledge units reference SQLite entities via:

- `workspace_id` → `workspaces.id` in SQLite
- `session_id` → `sessions.session_id` in SQLite

These are soft references (no foreign key enforcement across databases). The Cortex tolerates dangling references gracefully — if a workspace is deleted from SQLite, its knowledge units remain in LanceDB but are no longer returned in workspace-scoped queries (workspace doesn't exist = no results).

### Lifecycle Coupling

- **Workspace deleted** → Cortex workspace layer directory is not automatically deleted (knowledge may still be valuable in personal layer). A "Clean up Cortex data" option in UI allows explicit deletion.
- **Session deleted from SQLite** → Knowledge units sourced from that session remain (the knowledge is independent of the session index).
- **Bootstrap reads from** → Raw agent JSONL files on disk (not from SQLite). The SQLite index helps map sessions to workspaces, but the actual content comes from the source files.

### FTS5 Coexistence

The existing FTS5 full-text search (`sessions_fts`) continues to work for session content search. The Cortex adds semantic/vector search on top. The `/api/search` route could be extended to combine FTS5 keyword results with Cortex vector results for hybrid search, but this is not required for v1.

## Configuration

Cortex settings are stored as a `cortex` key within the existing `~/.spaces/config.json` (managed by `src/lib/config.ts`, extending `SpacesConfig`). This avoids a separate config file and keeps all Spaces configuration in one place.

The `~/.spaces/cortex/` directory contains only LanceDB data files, not configuration.

## Performance Budget

### Hook/MCP Injection Latency Target: <200ms (local only)

| Step | Budget |
|------|--------|
| Query signal extraction | 5ms |
| LanceDB search (personal + workspace) | 20-50ms |
| Reranking + staleness scoring | 10ms |
| Result formatting | 5ms |
| **Total local** | **40-70ms** |

Federation queries are fire-and-forget with a 500ms timeout. If federation results arrive before the agent processes the prompt, they're included. If not, local results are sufficient. Federation results may also arrive and be available for the *next* prompt.

### Disk Space Management

- **Warning threshold:** Cortex UI shows a warning when total Cortex storage exceeds 500MB
- **Maximum size:** Configurable (default: 2GB). When exceeded, automatic pruning removes lowest-confidence + highest-staleness entries first
- **Pruning strategy:** Remove `conversation` type chunks first (lowest value), then `command`, then stale `context`. Never auto-prune `decision`, `preference`, or `error_fix` types — these are too valuable.

## Active Knowledge Propagation (Cortex-to-Cortex Teaching)

In federated environments, Cortex nodes don't just respond to queries — they actively teach each other. High-confidence knowledge propagates across the network automatically, creating a distributed intelligence mesh where every node benefits from every other node's experience.

### Propagation Mechanics

When a Cortex node produces a knowledge unit that crosses a **propagation threshold**, it becomes a candidate for teaching:

| Criteria | Threshold | Rationale |
|----------|-----------|-----------|
| Confidence score | ≥ 0.85 | Only propagate knowledge the source node is confident about |
| Type | `decision`, `pattern`, `preference`, `error_fix` | High-value types only — raw `conversation` and `context` chunks stay local |
| Layer | `team` | Personal and workspace knowledge are never propagated automatically |
| Validation | User-validated or repeated 3+ times | Prevents propagation of noise |

### Propagation Flow

```
Node A discovers high-confidence pattern
  │
  ▼
Propagation check: confidence ≥ 0.85, team layer, validated type?
  │ yes
  ▼
Package as teaching unit:
  { knowledge, source_node, confidence, provenance_chain }
  │
  ▼
Push to all paired federation nodes via:
  - Real-time sync: WebSocket push (immediate)
  - Background sync: included in next sync batch
  - Query-only: piggyback on next query response as "suggested knowledge"
  │
  ▼
Receiving node (Node B):
  1. Dedup check — already have this? (cosine similarity > 0.95 → skip)
  2. Contradiction check — conflicts with local knowledge? → flag for review
  3. Confidence adjustment — remote knowledge arrives at 0.8 × source confidence
     (trust but verify — local experience always ranks higher)
  4. Store in team layer with provenance: "Learned from Node A"
  │
  ▼
Node B's agents now benefit from Node A's experience
```

### Provenance Chain

Every propagated knowledge unit carries a provenance chain — a record of where the knowledge originated and how it traveled:

```json
{
  "origin_node": "node-abc",
  "origin_timestamp": "2026-03-10T14:30:00Z",
  "hops": [
    { "node": "node-abc", "confidence": 0.92, "timestamp": "2026-03-10T14:30:00Z" },
    { "node": "node-def", "confidence": 0.74, "timestamp": "2026-03-10T15:00:00Z" }
  ],
  "max_hops": 3
}
```

**Max hops** prevents knowledge from echoing endlessly across the network. Default: 3 hops. Knowledge that has traveled through 3 nodes is not propagated further (it's available via query delegation if needed).

### Confidence Decay Across Hops

Each hop reduces confidence by 20%:

- **Origin:** 0.92
- **Hop 1:** 0.92 × 0.8 = 0.74
- **Hop 2:** 0.74 × 0.8 = 0.59
- **Hop 3:** 0.59 × 0.8 = 0.47 (no further propagation)

This ensures that firsthand knowledge always outranks secondhand knowledge. A node's own direct experience is always the strongest signal.

### Contradiction Resolution

When propagated knowledge contradicts local knowledge:

1. **Local wins by default** — Local knowledge has higher base confidence (no hop decay)
2. **Flag for review** — The contradiction is surfaced in the Cortex panel: "Node X says Y, but you've been doing Z. Which is correct?"
3. **User resolves** — User can accept the remote knowledge (updates local), reject it (downranks the remote unit), or mark as "context-dependent" (both valid in different situations)
4. **Resolution propagates** — If the user explicitly validates remote knowledge, that validation propagates back to the source node as a confidence boost

### Rate Limiting

- **Per-node-pair:** Max 50 knowledge units pushed per sync cycle
- **Dedup window:** Knowledge within 0.95 cosine similarity of existing units is silently dropped
- **Backpressure:** If a receiving node's ingestion queue exceeds 500 items, it signals the sender to slow down

### API Additions

```
# Federation teaching endpoints (served to remote nodes)
POST   /api/cortex/federation/teach     — receive propagated knowledge
GET    /api/cortex/federation/pending    — knowledge pending review (contradictions)
POST   /api/cortex/federation/resolve    — resolve contradiction
```

## Deferred / Future Considerations

- **Knowledge graph visualization** — 3D visualization of how knowledge units relate (could reuse R3F infrastructure)
- **Auto-CLAUDE.md generation** — Cortex distills its most confident preferences/patterns into a CLAUDE.md file automatically
- **Multi-modal knowledge** — Screenshots, diagrams, architecture images stored alongside text
- **Knowledge unit voting** — In teams, members can upvote/downvote knowledge units to improve confidence scoring
