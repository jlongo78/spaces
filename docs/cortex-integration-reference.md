# Cortex Integration Reference - How Hooks Work Per Agent

This documents how the Cortex RAG system integrates with each CLI agent so the Codex path stays aligned with the real agent contracts.

---

## Architecture Overview

There are **4 layers** of Cortex integration for each agent:

1. **Static context** - `.spaces/cortex-context.md` written at pane spawn time
2. **Per-prompt RAG hook** - fires before the LLM sees each prompt, searches Cortex, injects results as `additionalContext`
3. **Per-turn learn hook** - fires after each response, reads the transcript JSONL, extracts the last Q&A, POSTs it to Cortex for ingestion + distillation
4. **MCP server** - on-demand tool access for the agent to search/teach Cortex manually

---

## How Each Integration Layer Works

### Layer 1: Static Context (all agents)

At pane spawn time, `terminal-server.js` calls `injectCortexContext(cwd, workspaceId, ws)`:
- Queries `GET /api/cortex/search?q={projectName}+workspace+context&limit=10&workspace_id={id}`
- Formats results into a `<cortex-context>` XML block
- Writes to `.spaces/cortex-context.md` in the project directory
- Any agent can read this file as baseline context

### Layer 2: RAG Hook (`cortex-hook.js`)

**What it does:** On every user prompt, searches Cortex and injects relevant knowledge.

**Input (stdin JSON):**
```json
{
  "session_id": "uuid",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/project/dir",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "the user's actual prompt text"
}
```

**Logic:**
1. Reads `input.prompt` from stdin JSON
2. Skips if prompt is shorter than 10 characters
3. Reads `spaces-env.json` from `.claude/`, `.gemini/`, or `.codex/` for port + workspace ID
4. Calls `GET http://localhost:{port}/api/cortex/context/?q={prompt}&limit=5&workspace_id={id}`
5. If results are found, writes to stdout:
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<cortex-context>\n[Decision] 2026-04-01: ...\n</cortex-context>"
  }
}
```
6. The CLI prepends `additionalContext` to the prompt as a system reminder

**File:** `~/.spaces/packages/cortex/src/hooks/cortex-hook.js` and `bin/cortex-hook.js`

### Layer 3: Learn Hook (`cortex-learn-hook.js`)

**What it does:** After each response, extracts the last Q&A from the transcript and ingests it into Cortex.

**Input (stdin JSON):**
```json
{
  "session_id": "uuid",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/project/dir",
  "hook_event_name": "Stop",
  "stop_reason": "end_turn"
}
```

**Logic:**
1. Reads `input.transcript_path` from stdin JSON
2. Opens the JSONL file and walks backwards to find:
   - The last assistant message
   - The preceding real user prompt, skipping `tool_result` payloads
3. Formats as `Q: {prompt}\nA: {response}` and truncates each side to 4000 chars
4. POSTs to `http://localhost:{port}/api/cortex/knowledge/`:
```json
{
  "text": "Q: user prompt\nA: assistant response",
  "type": "conversation",
  "workspace_id": "15",
  "layer": "workspace"
}
```
5. The knowledge endpoint embeds it, stores it, and enqueues distillation

**File:** `~/.spaces/packages/cortex/src/hooks/cortex-learn-hook.js` and `bin/cortex-learn-hook.js`

### Layer 4: MCP Server (`cortex-mcp.js`)

**What it does:** Provides on-demand Cortex tools the agent can call explicitly.

**Protocol:** JSON-RPC over stdio (MCP standard)

**Available tools** (from `/api/cortex/mcp/tools`):
- `cortex_search`
- `cortex_teach`
- `cortex_status`
- `cortex_timeline`
- `cortex_context`
- `cortex_export`
- `cortex_import`

**File:** `bin/cortex-mcp.js`

---

## Per-Agent Hook Configuration

### Claude Code

**Config file:** `.claude/settings.local.json`

**Hook events:**
- `UserPromptSubmit` -> `cortex-hook.js` (timeout: 15s)
- `Stop` -> `cortex-learn-hook.js` (timeout: 10s)
- `SessionStart` -> `spaces-hook.js` when Teams is installed

**MCP:** `mcpServers.cortex` in the same file

**Env file:** `.claude/spaces-env.json`

### Gemini CLI

**Config file:** `.gemini/settings.json`

**Hook events:**
- `BeforeAgent` -> `cortex-hook.js` (timeout: 15000ms)
- `AfterAgent` -> `cortex-learn-hook.js` (timeout: 10000ms)
- `SessionEnd` -> `cortex-learn-hook.js` (timeout: 10000ms)

**MCP:** `mcpServers.cortex` in the same file

**Env file:** `.gemini/spaces-env.json`

**Gemini differences:**
- Event name is `BeforeAgent`, not `UserPromptSubmit`
- The `BeforeAgent` hook uses `matcher: "*"`
- Timeout units are milliseconds
- Gemini keeps both per-turn and session-end learn hooks

### Codex CLI

**Config files:** `.codex/hooks.json` for hook definitions and `.codex/config.toml` for feature flags + MCP

**Hook events:**
- `UserPromptSubmit` -> `cortex-hook.js` (timeout: 5s)
- `Stop` -> `cortex-learn-hook.js` (timeout: 10s)

**Feature flag:** `[features] codex_hooks = true` in `.codex/config.toml`

**MCP:** `[mcp_servers.cortex]` in `.codex/config.toml`

**Env file:** `.codex/spaces-env.json`

**Confirmed from Codex docs / local CLI:**
- Codex uses `~/.codex/config.toml` for user config
- Codex supports project overrides in `.codex/config.toml` for trusted projects
- Codex hooks use the same event names here: `UserPromptSubmit` and `Stop`
- Codex hook timeouts are in seconds
- Codex hooks are currently disabled on Windows
- MCP servers are configured in TOML under `mcp_servers.*`, not `config.json`

```json
// .codex/hooks.json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/cortex-hook.js\"",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"/path/to/cortex-learn-hook.js\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

```toml
# .codex/config.toml
[features]
codex_hooks = true

[mcp_servers.cortex]
command = "node"
args = ["/path/to/cortex-mcp.js"]
env = { SPACES_URL = "http://localhost:3458", SPACES_INTERNAL_TOKEN = "first-16-chars-of-secret" }
```

---

## Hook I/O Contract Summary

| Field | UserPromptSubmit (input) | Stop (input) | Hook output |
|-------|---------------------------|--------------|-------------|
| `session_id` | yes | yes | - |
| `transcript_path` | yes | yes | - |
| `cwd` | yes | yes | - |
| `hook_event_name` | `"UserPromptSubmit"` | `"Stop"` | - |
| `prompt` | the user's text | - | - |
| `stop_reason` | - | `"end_turn"` etc | - |
| `hookSpecificOutput` | - | - | `{ hookEventName, additionalContext }` |

---

## JSONL Transcript Format (for learn hook)

Each line in the transcript JSONL:
```json
{
  "type": "user" | "assistant",
  "message": {
    "role": "user" | "assistant",
    "content": "string" | [{ "type": "text", "text": "..." }, { "type": "tool_use", "...": "..." }]
  },
  "timestamp": "...",
  "sessionId": "..."
}
```

User entries whose `content` array is entirely `tool_result` blocks are not human prompts and should be skipped.

---

## Spaces-env.json

Written at spawn time for each agent:
```json
{
  "port": "3458",
  "workspaceId": "15"
}
```

The hooks read this to know which local Cortex API port and workspace to use.

---

## What Codex Needs for Full Parity

1. Write Codex MCP config to `.codex/config.toml`, not `.codex/config.json`
2. Enable hooks with `[features] codex_hooks = true`
3. Keep Codex hook definitions in `.codex/hooks.json`
4. Keep using `UserPromptSubmit` and `Stop`
5. Treat Codex timeouts as seconds
6. Keep `.codex/spaces-env.json` lookup in both hooks
7. Treat Windows as partial parity only until Codex re-enables hooks there
