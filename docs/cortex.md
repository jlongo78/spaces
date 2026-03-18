# Cortex — RAG Knowledge Engine

Cortex is a workspace-scoped knowledge engine that gives Claude Code persistent memory across sessions. It learns from conversations, retrieves relevant context via RAG (Retrieval-Augmented Generation), and distills structured insights using LLM processing.

**Tier**: Team / Federation only (not available on Community tier)

---

## Architecture

```
                  ┌──────────────────────────────────────┐
                  │         Claude Code Session           │
                  │                                      │
  UserPromptSubmit │  ┌──────────┐     ┌──────────────┐  │ Stop hook
  hook fires ──────┤  │ RAG Hook │     │  Learn Hook  │──┤──────────
                  │  │ (inject) │     │   (store)    │  │
                  │  └────┬─────┘     └──────┬───────┘  │
                  └───────┼──────────────────┼──────────┘
                          │                  │
                          ▼                  ▼
                  ┌──────────────┐   ┌──────────────────┐
                  │ Context API  │   │ Knowledge API    │
                  │ /api/cortex/ │   │ /api/cortex/     │
                  │   context    │   │   knowledge      │
                  └──────┬───────┘   └───────┬──────────┘
                         │                   │
                         ▼                   ▼
              ┌─────────────────────────────────────────┐
              │           Cortex Engine                  │
              │                                         │
              │  ┌─────────┐  ┌────────────┐  ┌──────┐ │
              │  │ Context │  │ Ingestion  │  │Store │ │
              │  │ Engine  │  │ Pipeline   │  │      │ │
              │  └────┬────┘  └─────┬──────┘  └──┬───┘ │
              │       │             │             │     │
              │       │    ┌────────┴──────────┐  │     │
              │       │    │  Distillation     │  │     │
              │       │    │  Queue/Scheduler  │  │     │
              │       │    └────────┬──────────┘  │     │
              │       │             │             │     │
              │       ▼             ▼             ▼     │
              │  ┌──────────────────────────────────┐   │
              │  │     LanceDB Vector Store         │   │
              │  │  personal/ workspace/N team/     │   │
              │  └──────────────────────────────────┘   │
              └─────────────────────────────────────────┘
```

## Components

### Hooks (Claude Code integration)

| Hook | File | Fires When | Does What |
|------|------|-----------|-----------|
| RAG injection | `bin/cortex-hook.js` | `UserPromptSubmit` | Queries Cortex for relevant knowledge, prepends to prompt |
| Learn | `bin/cortex-learn-hook.js` | `Stop` (after Claude responds) | Stores Q&A pair as vectors in workspace-scoped layer |

Both hooks read `SPACES_PORT` and `SPACES_SESSION_SECRET` from their baked-in environment. When inside a workspace, they read `workspace_id` from `.claude/spaces-env.json` (written at pane spawn).

### Storage Layers

Knowledge is stored in LanceDB, partitioned by layer:

| Layer Key | Scope | Example |
|-----------|-------|---------|
| `personal` | User's private knowledge | Your coding preferences |
| `workspace/2` | Scoped to workspace ID 2 | Project-specific patterns |
| `workspace` | Legacy workspace key | Backward compat with bootstrap data |
| `team/default` | Shared across team | Organization conventions |

### Lobe Resolver

Lobes determine which layers to search for a given workspace. The resolver (`src/lib/cortex/lobes/resolver.ts`) returns a weighted list of layers based on:
- Workspace ID and privacy settings
- Lobe tag inclusions/exclusions
- Personal vs shared visibility

### Embedding Providers

Provider chain with automatic fallback:

1. **Voyage AI** — if `VOYAGE_API_KEY` set (1024 dims)
2. **OpenAI** — if `OPENAI_API_KEY` set (1536 dims)
3. **Local** — `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` (384 dims, ~22MB model)

The local provider runs on CPU. ONNX tensors are disposed after each embedding to prevent memory leaks.

### Distillation

When enabled, each stored Q&A pair is also queued for LLM distillation. The distiller runs 4 extraction passes using Claude Haiku:

| Pass | Extracts | Output Type |
|------|----------|-------------|
| decisions | Architecture/tech choices | `decision` |
| patterns | Recurring approaches/conventions | `pattern` |
| preferences | User corrections/style choices | `preference` |
| error_fixes | Error/solution pairs | `error_fix` |

**Cost**: ~$0.03–0.05 per session end (4 Haiku API calls). Tracked in `~/.spaces/cortex/usage.json` and displayed in Settings.

**API Key**: Set via Settings UI (stored in `~/.spaces/config.json` under `cortex.anthropic_api_key`) or via `ANTHROPIC_API_KEY` environment variable. Falls back to `OPENAI_API_KEY` / `gpt-4o-mini` if no Anthropic key.

### Context Engine

The context engine (`src/lib/cortex/retrieval/context-engine.ts`) assembles search results from multiple layers with:
- Per-layer weighted scoring (workspace layers weigh higher than personal)
- Cosine similarity from LanceDB vector search
- Type-based relevance boosts (code patterns scored higher than raw conversations)
- Staleness decay (configurable half-life per knowledge type)
- Deduplication across layers

### Entity Graph

A SQLite-backed graph (`graph.db`) tracking relationships between:
- People, workspaces, projects, git branches, topics, agent types

Populated via `/api/cortex/graph/populate` from session data. Visualized with `force-graph` in the Cortex UI tab.

---

## Configuration

All Cortex config lives under the `cortex` key in `~/.spaces/config.json`:

```jsonc
{
  "cortex": {
    "enabled": true,
    "debug": false,                    // Verbose logging (memory, LanceDB, distillation internals)
    "anthropic_api_key": "sk-ant-...", // For distillation (optional, falls back to env)

    "embedding": {
      "provider": "auto",              // auto | voyage | openai | local
      "model": null,
      "fallback": "local",
      "dimensions": null               // Auto-detected from provider
    },
    "injection": {
      "enabled": true,
      "max_tokens": 5000,              // Token budget per prompt injection (max: 20000)
      "max_results": 10,
      "min_confidence": 0.3
    },
    "ingestion": {
      "auto_ingest": true,
      "distillation": true,            // LLM distillation (costs API credits)
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
      "sync_mode": "query-only",       // query-only | background-sync | real-time-sync
      "sync_interval_minutes": 5,
      "query_timeout_ms": 500
    },
    "storage": {
      "max_size_mb": 2048,
      "warning_threshold_mb": 500
    }
  }
}
```

Settings can be changed via the UI (Settings > Cortex) without restarting — the Cortex singleton re-initializes on next use after any settings change.

---

## API Routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/cortex/settings` | GET | Session | Read Cortex config (always accessible, even when disabled) |
| `/api/cortex/settings` | POST | Session | Update config + trigger Cortex re-initialization |
| `/api/cortex/context` | GET | Session/Internal | RAG context assembly with lobe resolution |
| `/api/cortex/knowledge` | POST | Session/Internal | Store knowledge unit + enqueue for distillation |
| `/api/cortex/search` | GET | Session/Internal | Vector similarity search across layers |
| `/api/cortex/usage` | GET | Session | Distillation usage stats (calls, tokens, cost) |
| `/api/cortex/usage` | DELETE | Session | Reset usage counters |
| `/api/cortex/graph/entities` | GET | Session | List graph entities |
| `/api/cortex/graph/edges` | GET | Session | List graph edges |
| `/api/cortex/graph/populate` | POST | Session | Build graph from workspace/session data |
| `/api/cortex/status` | GET | Session | Cortex health/status |
| `/api/cortex/ingest/bootstrap` | POST | Session | Bulk ingest existing files |
| `/api/cortex/ingest/status` | GET | Session | Bootstrap progress |

Internal routes use `x-spaces-internal` header with a truncated session secret for hook-to-API communication.

---

## Data Storage

```
~/.spaces/
├── config.json           # Contains cortex.* settings + API keys
└── cortex/
    ├── graph.db          # SQLite entity graph
    ├── usage.json        # Distillation cost tracking
    ├── distill-queue.json # Pending distillation items
    ├── ingest-state.json # Bootstrap ingestion state
    ├── personal/
    │   └── knowledge.lance/  # Personal knowledge vectors
    ├── workspace/
    │   ├── 1/
    │   │   └── knowledge.lance/
    │   └── 2/
    │       └── knowledge.lance/
    └── team/
        └── knowledge.lance/
```

---

## Lifecycle

### Per-prompt (RAG injection)

1. User types a prompt in Claude Code
2. `UserPromptSubmit` hook fires → `bin/cortex-hook.js`
3. Hook calls `/api/cortex/context?q={query}&workspace_id={id}`
4. Context engine resolves lobes → searches relevant layers → scores/deduplicates
5. Top results (within token budget) prepended to prompt

### Per-response (learning)

1. Claude finishes responding
2. `Stop` hook fires → `bin/cortex-learn-hook.js`
3. Hook posts Q&A pair to `/api/cortex/knowledge`
4. Knowledge stored as vector in workspace-scoped layer
5. If distillation enabled: chunk enqueued → scheduler fires 4 Haiku extraction passes → structured units stored

### Settings change

1. User toggles setting in UI
2. POST to `/api/cortex/settings` saves config
3. `resetCortex()` destroys singleton (stops federation sync, distillation scheduler, closes graph DB)
4. Next API call re-initializes Cortex with new config

---

## Enabling / Disabling

When **disabled** (`cortex.enabled: false`):
- No hooks injected into Claude Code sessions
- No MCP server configured
- No injection badge in terminal UI
- No Cortex nav items
- Settings page still accessible (so you can re-enable)
- Terminal server skips injection attempts (no timeout errors)

When **enabled** (`cortex.enabled: true`):
- Hooks + MCP config written to `.claude/settings.local.json` at pane spawn
- `spaces-env.json` written with workspace ID
- RAG injection on every prompt, learning on every response
- Badge shows live result count
- Distillation runs if API key is configured

---

## Debug Logging

Toggle in Settings > Cortex > Debug logging, or set `cortex.debug: true` in config.

When enabled, emits:
- `[Cortex Debug] [Embed]` — Memory deltas per embedding batch
- `[Cortex Debug] [LanceDB]` — Memory deltas per search operation
- `[Cortex Debug] [Distill]` — Per-pass extraction details and timing
- `[Memory]` — Periodic heap/RSS/external tracking (every 60s)

Always-on logs (regardless of debug flag):
- `[Cortex Store]` — Knowledge unit stored
- `[Cortex Search]` — Per-layer hit counts
- `[Cortex Context]` — Query results summary
- `[Cortex Distill] Done:` — Distillation summary (units created, errors)
- `[Cortex] Distillation pipeline ready` — Startup confirmation
- `[Cortex] Injected N knowledge units` — Terminal injection count

---

## Known Issues

- **Memory growth**: LanceDB + ONNX runtime accumulate memory over long-running sessions. Mitigated with 8GB heap limit (`--max-old-space-size=8192` via re-exec in `spaces.js`), ONNX tensor disposal, and LanceDB table caching. Debug logging can help identify the growth source.
- **Local embedding speed**: CPU-based `all-MiniLM-L6-v2` is slow (~500ms/embed). Use Voyage or OpenAI for production.
- **Layer key format**: Must use `/` not `:` (e.g. `workspace/2` not `workspace:2`) — Windows doesn't allow colons in directory names.
