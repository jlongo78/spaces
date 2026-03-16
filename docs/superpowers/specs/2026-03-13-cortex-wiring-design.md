# Cortex Wiring & Roadmap Design Spec

**Date:** 2026-03-13
**Status:** Draft
**Scope:** Wire up 5 existing-but-unused Cortex subsystems; define roadmap for future phases

---

## Background

Cortex is a RAG knowledge layer that ingests Claude conversation history into LanceDB, then injects relevant context into prompts. The basic ingest → embed → store → search → inject loop works, but several subsystems were implemented and never connected to the pipeline:

- **Distiller** — LLM-based extraction of decisions, patterns, preferences, error fixes
- **Deduplicator** — cosine similarity duplicate detection
- **Extractors** — regex-based classification of conversation chunks
- **Staleness** — file-change-aware decay scoring
- **MCP server** — 10 tool definitions with no mounting point

This spec covers wiring all 5 into the working system, then defines 4 future phases.

---

## Phase 1: Layered Wiring (Immediate Work)

Each layer builds on the previous one. Each is independently shippable and testable.

### Layer 1: Deduplication

**Goal:** Prevent duplicate knowledge units from accumulating in the store.

**Where:** `pipeline.ts` — the dedup check replaces the current direct path from chunking to embedding. Chunks are embedded first, then checked for duplicates before storing.

**Revised pipeline order:** chunk → embed → dedup check → store (if not duplicate)

**Two-phase check:**

1. **Hash check (instant, pre-embed):** SHA-256 of normalized text. Maintained as an in-memory `Set<string>` on the pipeline instance, populated from the store on init. Catches exact re-ingestion (e.g., bootstrap re-running over already-ingested files). Hash matches skip embedding entirely.

2. **Cosine check via store search (post-embed):** For chunks that pass the hash check, embed the chunk, then use `store.search(layerKey, candidateVector, 1)` to find the nearest neighbor. If the nearest result has distance < 0.05 (similarity > 0.95), it's a duplicate. This uses LanceDB's native vector search — the existing `isDuplicate()` function in `deduplicator.ts` compares two individual vectors and is not suitable for store-wide checks.

**Vector reuse:** Since the cosine check requires embedding the chunk, and the store also needs the vector, the embedded vector is cached and reused for the `store.add()` call. No double-embedding.

**Duplicate handling:**
- Hash match → skip silently, don't embed
- Cosine match → skip storing, but bump `access_count` on the matched existing unit (validates its relevance)

**Files changed:**
- `pipeline.ts` — restructure Tier 2 to: embed → hash check → cosine check via `store.search()` → store
- `deduplicator.ts` — add `textHash(text: string): string` utility. Keep existing `isDuplicate()` / `cosineSimilarity()` for other use cases (e.g., federation teach route)
- `store.ts` — add `updateAccessCount(layerKey: string, id: string): Promise<void>` method

---

### Layer 2: Extractors

**Goal:** Enrich chunks with specific type classifications and metadata before embedding.

**Where:** `pipeline.ts` — after chunking, before embedding. Runs on each `RawChunk`.

**Classification logic:**

Each chunk currently defaults to type `conversation`. After extraction:
- `detectErrorFixPairs()` matches → type becomes `error_fix`, file refs extracted from stack traces
- `extractDecisionPatterns()` matches → type becomes `decision`
- `extractCommands()` finds commands → type stays as-is, commands added to `metadata.commands`
- Multiple matches: highest-value type wins (`decision` > `error_fix` > `conversation`)

Note: `code_pattern` is a valid knowledge type but no extractor currently produces it. It will be generated only by LLM distillation in Layer 4 (the `patterns` prompt). The regex extractors in this layer do not attempt to classify code patterns — that requires semantic understanding beyond regex.

**Key downstream effect:** These classifications determine which chunks get queued for LLM distillation in Layer 4. Only `decision` and `error_fix` types are queued. Plain `conversation` and `command` chunks are skipped — this is the cost control mechanism.

**`RawChunk` already has `metadata`:** The type in `types.ts` includes `metadata: Record<string, unknown>`, so no extension is needed.

**Files changed:**
- `pipeline.ts` — call extractors on each chunk after `chunkMessages()`, before embed
- `extractors.ts` — no changes needed, functions already implemented

---

### Layer 3: Staleness

**Goal:** Knowledge units that reference files which have since changed should rank lower in search results and be visually flagged.

**When computed:** At search/retrieval time, not at ingest time. Avoids filesystem checks during ingestion and ensures staleness is always current.

**How it works:**

The relevance formula in `search.ts` is: `similarity x confidence x (1 - stale_score) x recencyBoost x layerWeight` (the `layerWeight` multiplication happens in `search.ts`, not `scoring.ts`). Currently `stale_score` is always 0. This layer makes it real.

When `CortexSearch.search()` returns candidates:
1. For each result with `file_refs[]`, call `computeFileStaleScore()` from `staleness.ts`
2. It requires a `fileModTimes: Record<string, string>` map — built by calling `fs.stat()` on each referenced file
3. Computes exponential decay based on days elapsed since file change
4. Stale score feeds into existing relevance formula — stale units naturally rank lower

**File path resolution:** `file_refs` are stored as relative paths (from `extractFileRefs()` in `chunker.ts`). To resolve them for `fs.stat()`:
- The search API route receives the query context. For workspace-scoped searches, `project_path` on the knowledge unit provides the root.
- For the `personal` layer, results may reference files across different projects. Each unit's `project_path` is used as the resolution root.
- If `project_path` is null or the file doesn't exist, `stale_score` remains 0 (not stale, just unresolvable).

**Performance:** Staleness checks involve filesystem `stat()` calls. To keep search fast:
- Only check `file_refs` on the top N results (after initial vector search ranking), not all candidates
- Cache `stat()` results for the duration of a single search request (files don't change mid-request)
- Typical case: 5-10 results with 1-3 file refs each = 5-30 stat calls, well under 10ms total

**UI indicator:** In `knowledge-card.tsx`, if `stale_score > 0.3`, show an amber indicator with tooltip "Referenced files have changed since this was learned". No deletion, no archiving — stale units just rank lower. User can manually delete via existing button.

**Files changed:**
- `search.ts` — add staleness computation after vector search, before final scoring/ranking
- `staleness.ts` — add Windows path normalization (backslash → forward slash) if needed
- `knowledge-card.tsx` — add amber staleness badge when `stale_score > 0.3`
- `src/app/api/cortex/search/route.ts` — pass filesystem context to search if needed

---

### Layer 4: Distillation

**Goal:** Extract structured knowledge (decisions, patterns, preferences, error fixes) from raw conversation chunks using LLM calls.

**`callLLM` implementation:**

New file `src/lib/cortex/distillation/llm.ts` with auto-detect:
1. `ANTHROPIC_API_KEY` present → Claude Haiku via Messages API (direct `fetch`, no SDK)
2. `OPENAI_API_KEY` present → GPT-4o-mini via Chat Completions API (direct `fetch`)
3. Neither → log warning, distillation disabled gracefully

**Selective distillation (fed by Layer 2 extractors):**

Not every chunk gets distilled. Only chunks classified as `decision` or `error_fix` by the extractors are queued. Plain `conversation` and `command` chunks are skipped. In practice ~10-20% of chunks qualify, which controls API cost. The `pattern` and `code_pattern` types are *outputs* of distillation (not inputs to it).

**Adapting the existing `DistillationScheduler`:**

The scheduler (`scheduler.ts`) uses:
- In-memory `pendingChunkIds: string[]` (not file-backed)
- Idle-debounce pattern: flushes 30 seconds after last enqueue (not periodic)
- Batch size of 50 (not 20)
- Callback signature: `(chunkIds: string[]) => Promise<void>`

We keep this design rather than rewrite it. Adaptations needed:

1. **ID-to-text resolution:** The scheduler hands off IDs, but `Distiller.distill()` takes text. Solution: when the pipeline enqueues a chunk for distillation, it also writes the chunk text to a lightweight JSON file at `~/.spaces/cortex/distill-queue.json` keyed by ID. The `onDistill` callback reads text from this file, passes to `Distiller.distill()`, then removes processed entries.

2. **Persistence across restarts:** The in-memory queue is lost on restart. The `distill-queue.json` file doubles as persistence — on init, any remaining entries are re-enqueued into the scheduler.

3. **Batch size stays at 50:** The 4 extraction prompts run once per batch (not per chunk), so 50 chunks per batch is fine. Cost estimate updated below.

4. **Idle debounce is appropriate:** Distillation runs 30s after the last ingest activity stops. This is better than a fixed interval — it processes soon after work is done, but doesn't interrupt active ingestion.

**Respects existing settings:** The distillation toggle in `cortex-settings.tsx` already writes `config.ingestion.distillation`. We read it to gate the scheduler. If disabled, enqueue is a no-op.

**Files changed:**
- New: `src/lib/cortex/distillation/llm.ts` — `callLLM` with provider auto-detect
- `src/lib/cortex/index.ts` — instantiate `Distiller` with callback, wire `DistillationScheduler`
- `pipeline.ts` — after storing qualifying chunks, enqueue their IDs + write text to queue file
- `scheduler.ts` — no changes to scheduler itself
- New: `src/lib/cortex/distillation/queue.ts` — JSON file read/write for chunk text keyed by ID, init-time recovery
- `config.ts` — read existing `distillation` toggle

---

### Layer 5: MCP Server

**Goal:** Expose Cortex as an MCP tool server so Claude Code and other agents can search, teach, and manage knowledge directly.

**Mounting approach:**

Register as a stdio MCP server that Claude Code discovers automatically. A small entry point script handles the transport:

`bin/cortex-mcp.js`:
1. Imports `handleToolCall` from `mcp/server.ts`
2. Wraps in stdio MCP transport (JSON-RPC over stdin/stdout)
3. Gets registered via settings written by `terminal-server.js`

**Auth context for standalone process:** The MCP server runs as a child process of Claude Code, which runs inside a terminal session. The entry point receives the Spaces server URL and session context via environment variables set during registration (same pattern as the existing cortex hooks). It calls the Cortex HTTP API endpoints rather than importing the Cortex singleton directly — this avoids LanceDB connection conflicts and auth context issues. The `handleToolCall` in `mcp/server.ts` is adapted to be a thin HTTP client wrapper.

**10 tools exposed:**
- `cortex_search` — vector search
- `cortex_teach` — manually add knowledge
- `cortex_forget` — delete a unit
- `cortex_status` — health + counts
- `cortex_recall` — retrieve by ID
- `cortex_similar` — find related units
- `cortex_context` — formatted context dump
- `cortex_timeline` — chronological view
- `cortex_export` / `cortex_import` — portability

**Registration:** `terminal-server.js` (`writeCortexHookConfig()`) already writes Claude Code settings for cortex hooks. Extend to also register the MCP server in `.claude/settings.local.json`, passing `SPACES_URL` and auth headers as env vars.

**Files changed:**
- New: `bin/cortex-mcp.js` — stdio MCP entry point, HTTP client to Spaces API
- `src/lib/cortex/mcp/server.ts` — adapt `handleToolCall` to work as HTTP client wrapper
- `terminal-server.js` — add MCP server registration to `writeCortexHookConfig()`

---

## Existing Bugs to Fix During Wiring

These are bugs discovered during exploration that should be fixed as part of this work:

1. **Client-side layer filtering** — `cortex-panel.tsx` fetches 20 results total, then filters by tab. If all 20 are `workspace`, other tabs show empty. Fix: add a `layer` query param to the search API route (`src/app/api/cortex/search/route.ts`), and have the panel send 3 separate requests (one per tab). Files: `cortex-panel.tsx`, `src/app/api/cortex/search/route.ts`.

2. **Exporter hardcodes 384-dim vector** — `exporter.ts` uses `new Array(384).fill(0)` as a dummy query vector for `store.search()`. This is functionally broken for any non-384-dim embedding provider (1024 for Voyage, 1536 for OpenAI). Fix: read dimensions from the store/embedding config and construct the dummy vector accordingly. File: `exporter.ts`.

3. **PATCH knowledge is non-atomic** — delete + re-insert with crash risk. Acceptable for now but noted as tech debt.

---

## Testing Strategy

Each layer ships with tests:

- **Layer 1 (Dedup):** Unit test `textHash()` for deterministic output. Unit test the pipeline with duplicate inputs and verify only one unit stored. Test `access_count` bump on cosine match.
- **Layer 2 (Extractors):** Unit test each extractor function (already pure functions with string input/output). Test pipeline classification with known error/fix and decision conversation samples.
- **Layer 3 (Staleness):** Unit test `computeFileStaleScore()` with mock file mod times. Test that stale results rank lower than fresh ones in search output.
- **Layer 4 (Distillation):** Unit test `callLLM` provider detection. Integration test with mocked LLM responses to verify end-to-end: enqueue → scheduler flush → distiller → store. Test queue persistence across simulated restart.
- **Layer 5 (MCP):** Integration test: start MCP server, send JSON-RPC tool calls, verify correct HTTP API calls made.

---

## Future Phases (Roadmap)

### Phase 2: Smarter Retrieval
- Multi-hop search: find related → find related to related
- Per-layer search queries (fix client-side filtering — included in Phase 1 bug fixes)
- Contradiction detection at search time
- Context-aware injection budget (complex prompts get more tokens)

### Phase 3: Better UI
- Timeline view (API exists, no UI)
- Knowledge graph visualization
- Inline editing of knowledge units
- "Why was this injected?" explanations
- Confidence tuning slider per unit
- Staleness management view for bulk review

### Phase 4: Active Learning
- Track whether injected context was useful (accepted vs ignored)
- Feedback loop: boost confidence on useful units, decay ignored ones
- Quick-reaction UI in injection badge ("helpful" / "not useful")

### Phase 5: Cross-Workspace Intelligence
- Promote workspace units to personal layer when useful across projects
- Wire up federation `connectedNodes` so team sync actually works (requires network discovery mechanism — largest unknown in the roadmap)
- Pattern transfer between similar project contexts

---

## Cost Estimate

Distillation uses Claude Haiku (or GPT-4o-mini as fallback):
- ~500-1000 input tokens per extraction prompt, ~200 output tokens
- 4 prompts per batch of up to 50 chunks
- Heavy day of use: maybe 5-10 batches = 20-40 API calls
- Estimated cost: $0.05-0.30/day at Haiku pricing
- All other layers (dedup, extractors, staleness, MCP) have zero API cost

---

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Distillation LLM cost | Direct API (Haiku) | Cheap enough to evaluate; easy to switch later |
| Dedup strategy | Hash + cosine via store search | Hash is instant for exact matches; store vector search catches paraphrases without double-embedding |
| Staleness behavior | Decay + visual flag | Stale doesn't mean wrong; let user decide |
| MCP server | Wire up now, HTTP client pattern | Already built; HTTP avoids LanceDB conflicts in child process |
| Implementation order | Layered | Each layer independently shippable and testable |
| Scheduler design | Keep existing idle-debounce | Better UX than fixed interval; add file-backed persistence |
