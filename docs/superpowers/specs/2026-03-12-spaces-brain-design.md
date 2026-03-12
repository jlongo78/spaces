# Spaces Brain — Continuous Knowledge System

**Date:** 2026-03-12
**Status:** Approved

## Summary

A persistent, self-building knowledge system for Spaces that continuously ingests all AI agent conversations, extracts decisions, patterns, preferences, and error resolutions, stores them as vector embeddings in LanceDB, and automatically injects relevant context into every prompt via hooks. Agents get smarter over time because the Brain remembers everything you've built, decided, and corrected — across all sessions, all agents, all projects.

The Brain operates across four knowledge layers (Personal, Workspace, Team, Federation), supports all agent types (Claude Code, Codex, Gemini, Aider), and integrates with Spaces' existing tier model (Community, Pro/Server, Teams, Federation).

## Design Principles

- **Zero config** — Brain works the moment it's enabled. No API keys required (falls back to local embeddings). No manual curation needed.
- **Fully automatic** — All conversations are ingested passively. The Brain decides what's worth remembering. Users never need to manually save knowledge.
- **Invisible when working, inspectable when curious** — The Brain enhances every prompt silently. But every injection is visible (pane header badge), every knowledge unit is browsable (Brain panel), and everything can be taught, corrected, or forgotten.
- **Privacy by default** — Personal knowledge never leaves your node. Workspace knowledge is shareable only if the workspace is collaborative. Team knowledge flows only between paired federation nodes.

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
  │  Personal layer: ~/.spaces/brain/personal/
  │  Workspace layer: ~/.spaces/brain/workspace/{id}/
  │  Team layer: ~/.spaces/brain/team/ (cache from federation queries)
  ▼
Retrieval & Injection
  │  Hook injection: automatic, every prompt, <200ms
  │  MCP tool: agent-driven deep queries
  │  Federation query: transparent delegation to remote nodes
  ▼
Agent receives prompt + relevant Brain context
```

### Knowledge Layers

Four layers, organized from most specific to most general:

| Layer | Scope | Privacy | Storage | Examples |
|-------|-------|---------|---------|----------|
| **Personal** | Your preferences and style | Never shared | `~/.spaces/brain/personal/` | "Prefers Zod", "No ORMs", "Terse output" |
| **Workspace** | Project-specific knowledge | Shareable if workspace is collaborative | `~/.spaces/brain/workspace/{id}/` | "Auth uses JWT", "DB schema v3", "Bug #247 fix" |
| **Team** | Shared conventions | Flows between federation nodes | `~/.spaces/brain/team/` (local cache) | "API uses /v2/ prefix", "All endpoints return {data, error}" |
| **Federation** | Org-wide patterns | Query delegation across nodes | Not stored locally — queried on demand | Cross-team patterns, org standards |

On every prompt, the Brain searches: Personal → Workspace → Team → Federation. Most specific wins. Results merged by relevance score.

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
| `summary` | Session summarization | 0.6 | 60 days | "Session built the Brain ingestion pipeline" |

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
- **User validation:** Explicit `brain_teach` → 0.95
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
5. **Inject** — Append `<brain-context>` block to prompt:

```
<brain-context>
Relevant context from your workspace history:

[Decision] 2026-03-10: Auth uses JWT with httpOnly cookies, refresh token rotation.
Source: session abc123, workspace "Backend API"

[Pattern] This project uses Zod schemas at API boundaries, validated in middleware.
Source: 4 sessions over 2 weeks, confidence: 0.92

[Error Fix] "ECONNRESET on WebSocket reconnect" — Fixed by adding exponential backoff
with jitter in the reconnect handler. See session def456.

[Preference] You previously corrected: "Don't mock the database in integration tests."
</brain-context>
```

For Claude Code: uses the `user-prompt-submit` hook.

For other agents (Codex, Gemini, Aider): terminal intercept approach — watches PTY input stream and injects context via wrapper script that prepends brain context to stdin.

### Path 2: MCP Tool (agent-driven, on-demand)

The Brain exposes an MCP server with these tools:

| Tool | Purpose | Key Params |
|------|---------|------------|
| `brain_search` | Semantic search across layers | query, layers, types, workspace_id, time_range, min_confidence, limit |
| `brain_recall` | Retrieve specific unit by ID or exact match | id, exact |
| `brain_context` | Full context for a workspace | workspace_id, depth (brief/full) |
| `brain_similar` | Find analogous past experiences | input, type (error/code/problem), limit |
| `brain_timeline` | Chronological decision/change history | workspace_id, project_path, limit |
| `brain_teach` | Explicitly store knowledge (confidence 0.95) | text, type, layer, workspace_id |
| `brain_forget` | Remove or downrank knowledge | id, query, action (delete/downrank) |
| `brain_status` | Brain health and stats | — |
| `brain_export` | Export brain to .brainpack | scope, workspace_id, include_embeddings, format |
| `brain_import` | Import .brainpack archive | path, target_layer, merge_strategy, re_embed |

### Path 3: Federation Query (transparent)

When team-layer results are needed:

1. Local Brain constructs search request (query embedding + filters)
2. Request goes to `GET /api/network/proxy/{nodeId}/api/brain/search`
3. Remote node runs search locally, returns results
4. Local Brain merges remote results with local by relevance score
5. All connected nodes queried in parallel, configurable timeout (default 500ms)

## Federation

### Three Sync Modes (per-node-pair setting)

| Mode | Behavior | Best For |
|------|----------|----------|
| **Query-only** (default) | No data replication. Query remote nodes on demand. | Privacy-conscious teams, intermittent connectivity |
| **Background sync** | Periodically pull team-layer knowledge and cache locally. Fall back to live query if cache stale. | Better latency, offline capability |
| **Real-time sync** | Continuous replication via WebSocket. Knowledge appears on all nodes within seconds. | Tight teams, same codebase, full trust |

Background sync: polls connected nodes every N minutes (default 5), imports new knowledge units using merge-by-similarity.

Real-time sync: persistent WebSocket to `/api/brain/federation/stream`. New team-layer units pushed as created.

### Privacy Model

- **Personal layer** — Never leaves your node. Not queryable by remote nodes.
- **Workspace layer** — Queryable by remote nodes only if the workspace has `collaboration: true`.
- **Team layer** — Always queryable by paired federation nodes. This is the shared knowledge pool.

## Import/Export (Portable Knowledge)

### .brainpack Format

```
my-project.brainpack (tar.gz)
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
- **Onboarding** — Senior dev exports workspace brain, new team member imports. Instant ramp-up.
- **Project handoff** — Export brain with codebase. Next developer gets the reasoning, not just the code.
- **Backup/restore** — Periodic export as backup
- **Machine migration** — Moving to new laptop? Export all brains, import on new machine.

## REST API

```
# Brain status and health
GET    /api/brain/status

# Knowledge CRUD
GET    /api/brain/search?q=...&layer=...&type=...
GET    /api/brain/knowledge/:id
POST   /api/brain/knowledge          — create (brain_teach)
PATCH  /api/brain/knowledge/:id      — update confidence/layer/metadata
DELETE /api/brain/knowledge/:id      — remove (brain_forget)

# Workspace context
GET    /api/brain/workspace/:id/context
GET    /api/brain/timeline?workspace_id=...

# Bootstrap
POST   /api/brain/ingest/bootstrap
GET    /api/brain/ingest/status

# Import/Export
POST   /api/brain/export             — body: {scope, workspace_id?, include_embeddings?}
POST   /api/brain/import             — multipart .brainpack upload
GET    /api/brain/import/status

# Settings
GET    /api/brain/settings
POST   /api/brain/settings

# Federation (served to remote nodes)
GET    /api/brain/federation/search  — remote search endpoint
WS     /api/brain/federation/stream  — real-time sync WebSocket
```

## UI Integration

### 1. Top Bar — Brain Status Indicator

Small purple "Brain" badge in the top bar, always visible. Shows knowledge unit count. Pulses gently during active ingestion or retrieval. Colors: green (healthy), amber (ingesting), red (error). Click to open Brain panel.

### 2. Brain Panel — Slide-out Knowledge Explorer

Opens from the right when Brain indicator is clicked:

- **Search bar** — Semantic search across all knowledge
- **Stats row** — Total units, distilled count, average confidence
- **Layer tabs** — Personal / Workspace / Team
- **Knowledge list** — Each unit shows: type badge (color-coded), text, confidence, source, age
- **Actions** — Teach Brain, Export, Settings

Knowledge type colors:
- Decision: blue (#60a5fa)
- Preference: pink (#f472b6)
- Pattern: green (#34d399)
- Error Fix: amber (#fbbf24)
- Context: gray (#94a3b8)

### 3. Pane Header — Brain Activity Badge

Each terminal pane header shows a small badge when the Brain injected context into the last prompt: "3 items" with a purple dot. Click to see exactly what context was provided. Builds trust through transparency.

### 4. Settings Page — Brain Configuration

Settings → Brain section:
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
src/lib/brain/
├── index.ts                 — Brain singleton, initialization
├── config.ts                — Brain settings management
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
│   ├── injection.ts         — Prompt augmentation (brain-context block)
│   ├── federation.ts        — Remote node query delegation
│   └── scoring.ts           — Confidence, staleness, relevance scoring
├── knowledge/
│   ├── types.ts             — Knowledge unit type definitions
│   ├── staleness.ts         — Staleness detection and decay
│   └── contradiction.ts     — Contradiction detection between units
├── portability/
│   ├── exporter.ts          — .brainpack export
│   └── importer.ts          — .brainpack import with merge strategies
└── mcp/
    └── server.ts            — MCP server exposing brain tools

src/app/api/brain/
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

src/components/brain/
├── brain-indicator.tsx      — Top bar status badge
├── brain-panel.tsx          — Slide-out knowledge explorer
├── brain-settings.tsx       — Settings page section
├── knowledge-card.tsx       — Individual knowledge unit display
└── injection-badge.tsx      — Pane header injection indicator

~/.spaces/brain/
├── config.json              — Brain settings
├── personal/                — Personal layer LanceDB tables
├── workspace/
│   ├── 1/                   — Workspace 1 LanceDB tables
│   ├── 2/                   — Workspace 2 LanceDB tables
│   └── .../
└── team/                    — Team layer cache (from federation)
```

## Deferred / Future Considerations

- **Brain-to-brain teaching** — One Brain recommends knowledge to another Brain on a different node (active push, not just passive query)
- **Knowledge graph visualization** — 3D visualization of how knowledge units relate (could reuse R3F infrastructure)
- **Auto-CLAUDE.md generation** — Brain distills its most confident preferences/patterns into a CLAUDE.md file automatically
- **Multi-modal knowledge** — Screenshots, diagrams, architecture images stored alongside text
- **Knowledge unit voting** — In teams, members can upvote/downvote knowledge units to improve confidence scoring
