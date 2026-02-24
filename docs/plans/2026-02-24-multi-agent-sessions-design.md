# Multi-Agent Session & Project Support

## Problem

Sessions and projects are only listed for Claude Code. Codex, Gemini, and Aider all store session history on disk but Spaces doesn't read it. Users can't browse, search, tag, or resume sessions for these agents.

## Decision

Shared DB schema with per-agent parsers (Approach A). Add `agent_type` column to existing tables. Write a parser per agent that maps native disk format into the shared `upsertProject`/`upsertSession` shape. Existing session list, search, tags, stars, and workspaces work automatically.

## Agent Storage Formats

| Agent | Location | Format | Resume |
|-------|----------|--------|--------|
| Claude | `~/.claude/projects/<encoded-path>/` | JSONL + sessions-index.json | `claude --resume <id>` |
| Codex | `~/.codex/sessions/YYYY/MM/DD/` | JSONL rollouts (first line = SessionMeta) | `codex resume <id>` |
| Gemini | `~/.gemini/tmp/<project-slug>/chats/` | JSON per session (ConversationRecord) | `gemini --resume <id>` |
| Aider | `<project>/.aider.chat.history.md` | Markdown (append-only, no session IDs) | N/A (one entry per project) |

## DB Schema Changes

### sessions table
- Add `agent_type TEXT DEFAULT 'claude'`
- Add index on `agent_type`

### projects table
- Add `agent_type TEXT DEFAULT 'claude'`
- Rename `claude_path` to `agent_path` (migration: add column, copy data, drop old)

### panes table
- Rename `claude_session_id` to `agent_session_id` (migration: add column, copy data)

## Config / Paths

Expand `getUserPaths()` to return:
```
codexDir:         ~/.codex/
codexSessionsDir: ~/.codex/sessions/
geminiDir:        ~/.gemini/
geminiChatsDir:   ~/.gemini/tmp/
```

For Aider (project-local storage), scan the user's configured `devDirectories` plus project paths already known from other agents.

## New Parser Modules

### src/lib/codex/parser.ts
- Scan `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`
- Read first JSONL line for `SessionMeta`: id (UUID), cwd, timestamp, cli_version, model_provider, agent_nickname
- Extract first user message as `firstPrompt`
- Derive project from `cwd` field
- Map to shared session shape

### src/lib/gemini/parser.ts
- Read `~/.gemini/projects.json` for project slug registry
- Scan `~/.gemini/tmp/<slug>/chats/session-*.json`
- Parse JSON: sessionId, startTime, lastUpdated, messages array, summary
- Extract firstPrompt from first user message
- messageCount from messages.length
- Map to shared session shape

### src/lib/aider/parser.ts
- Scan known project directories for `.aider.chat.history.md`
- One "session" per project (no session IDs in Aider)
- Use file mtime as modified timestamp
- Count `#### ` markers as approximate message count
- Extract first `#### ` line as firstPrompt
- Session ID = hash of project path

## Indexer Changes

`fullSync()` calls four sub-scanners sequentially in a single transaction:
1. `syncClaude()` (existing logic)
2. `syncCodex()` — scan `~/.codex/sessions/`
3. `syncGemini()` — scan `~/.gemini/tmp/*/chats/`
4. `syncAider()` — scan dev directories for `.aider.chat.history.md`

Each passes `agent_type` to `upsertProject()` / `upsertSession()`.

## agents.ts Updates

```typescript
codex: {
  resumeFlag: 'resume',        // subcommand, not flag
  supportsResume: true,
}
gemini: {
  resumeFlag: '--resume',
  supportsResume: true,
}
aider: {
  supportsResume: false,        // --restore-chat-history is not true resume
}
```

## Terminal Server Changes

Rename `claudeSessionId` to `agentSessionId` in WebSocket params and pane data.

Spawn logic per agent type when resuming:
- Claude: `claude --resume <sessionId>`
- Codex: `codex resume <sessionId>` (subcommand pattern)
- Gemini: `gemini --resume <sessionId>`

## UI Changes

### Session Filters (session-filters.tsx)
- Add agent-type filter row: colored chips for Claude, Codex, Gemini, Aider, All
- Filter passes `agentType` query param to `/api/sessions`

### Session List (session-list.tsx)
- Add small colored agent badge next to each session row
- Badge uses agent color from `AGENT_TYPES`

### Session API (api/sessions/route.ts)
- Add `agentType` query parameter for filtering
- Include `agentType` in response data

### Resume Picker (terminal/page.tsx)
- Mode toggle (New/Resume) now shows for Claude, Codex, and Gemini
- Resume picker filters sessions by the selected agent type
- Already works generically (queries `/api/sessions`)

### Pane Creation
- `claudeSessionId` renamed to `agentSessionId` throughout

## Aider Handling

Aider uses a single append-only markdown file per project with no session IDs or boundaries. Each project with a `.aider.chat.history.md` file appears as one "session" entry. No resume picker for Aider.

## Migration Strategy

All schema changes use `ALTER TABLE ADD COLUMN` with defaults, so existing data keeps working. Old `claude_path` and `claude_session_id` columns get data copied to new columns. Existing sessions get `agent_type = 'claude'` by default.
