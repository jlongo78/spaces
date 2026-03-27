# Pane Diff Review & Project Creation Wizard — Design Spec

**Date**: 2026-03-27
**Status**: Draft
**Features**: Two independent features inspired by Cline Kanban, adapted for Spaces

---

## Feature 1: Pane Diff Review

### Overview

A "Review Changes" button in each pane's header that shows a clean git diff of everything that changed since the pane was created (or since the user last reviewed). The diff renders inline within the pane with an option to pop it out to a separate window.

### Data Model

Add one column to the `panes` table:

```sql
ALTER TABLE panes ADD COLUMN diff_baseline_sha TEXT;
```

- `diff_baseline_sha` — the git commit SHA captured when the pane is created. Updated when the user clicks "Reset Baseline" (mark as reviewed).
- The diff itself is never stored — computed on demand.

On pane creation, the API runs `git rev-parse HEAD` from the pane's `cwd` and stores the result as `diff_baseline_sha`. If the directory is not a git repo, the field is left null.

### API

**`GET /api/panes/[id]/diff`**

Reads the pane's `cwd` and `diff_baseline_sha`. Runs from that directory:

- `git diff <baseline_sha> HEAD` — committed changes since baseline
- `git diff` — unstaged changes
- `git diff --cached` — staged changes
- `git status --porcelain` — new untracked files

Returns:

```typescript
interface PaneDiffResponse {
  baselineSha: string;
  currentSha: string;
  files: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }>;
  diff: string;          // unified diff text (all changes combined)
  untracked: string[];   // new files not yet tracked by git
}
```

Error cases:
- Pane `cwd` is not a git repo → 400 `{ error: "Not a git repository" }`
- `diff_baseline_sha` is null → 400 `{ error: "No baseline set" }`
- Pane not found → 404

**`POST /api/panes/[id]/diff/reset`**

Updates `diff_baseline_sha` to current HEAD (`git rev-parse HEAD` from pane's `cwd`). Returns the new SHA. This is the "mark as reviewed" action — subsequent diffs only show changes after this point.

### Frontend — Inline Diff Panel

**Pane header button**: A `GitCompareArrows` (lucide) icon button added to the pane title bar, next to existing buttons (minimize, maximize, popout, close). Only visible when `diff_baseline_sha` is not null (i.e., pane's cwd is a git repo).

**Changed file badge**: A small count badge on the button showing the number of changed files. Fetched via `GET /api/panes/[id]/diff?countOnly=true` on pane focus and every 30 seconds while the pane is visible. The `countOnly` query param returns only `{ fileCount: number }` instead of the full diff — fast enough for polling.

**Diff panel**: Toggling the button splits the pane vertically — terminal on top, diff panel below. The divider is resizable via drag.

**Diff panel contents**:
- **File list sidebar** (left): Clickable list of changed files with status icons (green +, red -, blue ~). Clicking a file scrolls the diff view to that file.
- **Diff view** (right): Unified diff with syntax highlighting. Green backgrounds for additions, red for deletions. Line numbers shown.
- **Toolbar**:
  - "Reset Baseline" button — calls `POST /api/panes/[id]/diff/reset`, clears the diff panel
  - "Pop Out" button — opens diff in a new window
  - "Copy Diff" button — copies raw unified diff to clipboard
  - "Collapse" button — closes the diff panel

**Component**: `src/components/terminal/pane-diff-panel.tsx`

### Popout

Clicking "Pop Out" opens a new window via `window.open()` pointing to `/terminal/pane/[id]/diff`. This route renders the diff viewer at full window size, identical to the inline version but without the terminal above it. Reuses the existing popout window infrastructure (BroadcastChannel sync, window geometry tracking).

**Route**: `src/app/(desktop)/terminal/pane/[id]/diff/page.tsx`

### Edge Cases

- **Non-git directory**: Button hidden. Tooltip on hover: "Not a git repository"
- **No changes**: Empty state in panel: "No changes since baseline"
- **Large diffs**: Truncate at 500KB with a "Show full diff" link that fetches without limit
- **Binary files**: Show "Binary file changed" placeholder per file
- **Pane cwd changed after creation**: Baseline SHA may not exist in new repo. Detect this (`git cat-file -t <sha>` fails) and prompt user to reset baseline.
- **Detached HEAD / no commits**: If repo has no commits, disable the button with tooltip "No commits in repository"

---

## Feature 2: Project Creation Wizard

### Overview

A guided project creation flow accessible from the workspace chooser. The user describes a project in a chat interface, has back-and-forth with an LLM to refine the plan, then hits "Go" to automatically create a fully configured workspace with the right agents, panes, and initial prompts.

### Entry Point

A "Plan a Project" button in the WorkspaceChooser component, alongside the existing "New Space" button. Uses a distinctive icon (e.g., `Wand2` or `Sparkles` from lucide) to signal the AI-assisted path. Clicking opens a full-screen modal overlay.

### Wizard Modal — Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Plan a Project                                    [X Close]│
├──────────────────────────────┬──────────────────────────────┤
│                              │                              │
│   Chat Interface             │   Live Project Plan          │
│                              │                              │
│   [LLM messages]             │   Workspace: "My Project"    │
│   [User messages]            │   Description: "..."         │
│                              │                              │
│                              │   Panes:                     │
│                              │   1. Research (Claude Code)  │
│                              │   2. Backend (Claude Code)   │
│                              │   3. Tests (Codex)           │
│                              │                              │
│   ┌────────────────────┐     │                              │
│   │ Type a message...  │     │                              │
│   └────────────────────┘     │   [Review Plan]              │
│                              │                              │
└──────────────────────────────┴──────────────────────────────┘
```

**Left panel**: Chat interface. Standard chat UX — user messages right-aligned, LLM messages left-aligned. Text input at bottom with send button.

**Right panel**: Live-updating project plan summary. Rebuilt after each LLM response. Shows workspace config and pane list as structured cards. "Review Plan" button at bottom becomes active once the plan has at least one pane defined.

### Chat Interface

**Component**: `src/components/wizard/wizard-chat.tsx`

Standard chat component with:
- Message list (scrollable, auto-scroll to bottom)
- Text input with send button (Enter to send, Shift+Enter for newline)
- Loading indicator while LLM responds
- No file upload, no voice — text only for v1

### LLM Integration

**API endpoint**: `POST /api/wizard/chat`

Request:
```typescript
interface WizardChatRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentPlan: ProjectPlan | null;
}
```

Response:
```typescript
interface WizardChatResponse {
  reply: string;
  plan: ProjectPlan;
}
```

The endpoint:
1. Reads the user's API key from `~/.spaces/config.json` (field: `anthropic_api_key` or `openai_api_key`, with Anthropic preferred)
2. Constructs a system prompt (see below) with the current plan as context
3. Calls the Claude API directly (`POST https://api.anthropic.com/v1/messages`)
4. Parses the response to extract both the conversational reply and the updated plan JSON
5. Returns both to the frontend

**No Cortex dependency.** This is a direct API call.

**System prompt** instructs the LLM to:
- Act as a project planning assistant for Spaces
- Ask about: project purpose, tech stack, scope, working directory, what agents would help
- Ask 1-2 questions at a time, not a wall of questions
- After each exchange, output an updated `ProjectPlan` JSON block alongside the conversational reply
- Know the available agent types: Claude Code, Codex, Gemini, Aider, Shell, Custom
- Suggest agent configurations based on the project description
- Converge toward a concrete plan, then suggest the user review it

**API key validation**: If no API key is configured, the wizard shows a message directing the user to Settings to add one. The chat is disabled until a key is present.

### ProjectPlan Schema

```typescript
interface ProjectPlan {
  workspace: {
    name: string;
    description: string;
    color: string;           // hex color, LLM can suggest or default to #6366f1
  };
  panes: Array<{
    title: string;
    agentType: 'claude' | 'codex' | 'gemini' | 'aider' | 'shell' | 'custom';
    cwd: string;
    initialPrompt?: string;  // injected as first input when agent starts
    customCommand?: string;  // for 'custom' agent type
    description: string;     // human-readable purpose (shown in plan review)
  }>;
  summary: string;           // one-paragraph project summary
}
```

### Plan Review Step

Clicking "Review Plan" transitions the modal from chat+summary layout to a full-width review view.

**Review view contents**:
- **Workspace section**: Name, description, color — all editable inline (text inputs, color picker)
- **Panes list**: Each pane shown as an editable card:
  - Title (text input)
  - Agent type (dropdown matching existing agent type selector)
  - Working directory (text input with browse/validate)
  - Initial prompt (expandable textarea)
  - Description (text, read-only context)
  - Delete button (remove pane from plan)
- **Add Pane button**: Manually add a pane with blank fields
- **"Back to Chat" button**: Returns to chat layout to refine further with the LLM
- **"Launch Space" button**: Executes the plan

**Validation before launch**:
- Workspace name is not empty
- At least one pane exists
- All pane cwds are non-empty
- Cwds are validated against the filesystem (show warning if directory doesn't exist, with option to create it)

### Launch Sequence

When user clicks "Launch Space":

1. `POST /api/workspaces` — create workspace with name, description, color
2. For each pane in order: `POST /api/panes` — create pane with title, agentType, cwd, customCommand, assigned to new workspace
3. `PUT /api/workspaces/active` — switch to the new workspace (via `switchWorkspace()`)
4. Close the wizard modal
5. Terminal page loads the new workspace's panes, agents start up

**Initial prompt injection**: For panes with `initialPrompt`, the terminal server writes the prompt text to the pty's stdin after detecting the agent is ready. Readiness is determined by watching for the agent's prompt indicator in stdout (e.g., Claude Code's `>` prompt). Fallback: a 2-second delay after process spawn if no prompt indicator is detected. The `initialPrompt` field is stored on the pane record and consumed once on first connection — the terminal server deletes it from the pane after injection so it doesn't re-fire on reconnect.

**Component**: `src/components/wizard/wizard-launch.ts` (logic) — calls existing API endpoints, no new backend needed for launch itself.

### Plan Persistence

The `ProjectPlan` JSON is saved to the workspace record after creation. Uses the existing `lobe_config` column (JSON field) with a `wizardPlan` key:

```typescript
// stored in workspaces.lobe_config
{
  ...existingLobeConfig,
  wizardPlan: ProjectPlan
}
```

This allows:
- Viewing the original plan later (potential future "Plan" tab in workspace settings)
- Re-launching or modifying the plan
- Understanding what a workspace was created for

### Draft Persistence

If the user closes the wizard mid-conversation, prompt: "Discard this plan?" with options:
- **Save Draft** — stores the current messages and plan in `localStorage` under key `spaces-wizard-draft`. Next time the wizard opens, it offers to resume.
- **Discard** — clears everything, closes modal.

Only one draft at a time. Starting a new wizard session while a draft exists prompts: "Resume previous draft or start fresh?"

### Edge Cases

- **No API key**: Wizard opens but chat is disabled. Banner: "Configure your API key in Settings to use the project wizard."
- **LLM returns malformed plan JSON**: Use the last valid plan. Show the conversational reply normally. Log the parse error.
- **LLM fails (network error, rate limit)**: Show error inline in chat: "Failed to get response. Try again." with retry button.
- **Empty plan at review**: "Review Plan" button disabled with tooltip: "Describe your project first"
- **Very large plan (20+ panes)**: No hard limit, but warn: "This will create X panes. Continue?"
- **Invalid cwd at launch**: Show validation errors on the review screen. Highlight panes with issues. Block launch until resolved or user confirms directory creation.

---

## New Files Summary

### Feature 1: Pane Diff Review
- `src/app/api/panes/[id]/diff/route.ts` — GET diff, POST reset baseline
- `src/components/terminal/pane-diff-panel.tsx` — inline diff viewer component
- `src/app/(desktop)/terminal/pane/[id]/diff/page.tsx` — popout diff page

### Feature 2: Project Creation Wizard
- `src/app/api/wizard/chat/route.ts` — LLM chat endpoint
- `src/components/wizard/project-wizard.tsx` — main wizard modal
- `src/components/wizard/wizard-chat.tsx` — chat interface component
- `src/components/wizard/wizard-plan-summary.tsx` — live plan summary panel
- `src/components/wizard/wizard-review.tsx` — plan review/edit view
- `src/components/wizard/wizard-launch.ts` — launch sequence logic

### Modified Files
- `src/lib/db/schema.ts` — add `diff_baseline_sha` column to panes table
- `src/lib/db/queries.ts` — update pane creation to capture baseline SHA, add diff queries
- `src/components/terminal/terminal-pane.tsx` — add diff button to header, inline panel toggle
- `src/components/workspace/workspace-chooser.tsx` — add "Plan a Project" button

---

## Dependencies

### Feature 1
- No new npm dependencies required. Git commands run via `child_process.execSync` (or `execFile` for safety) server-side. Diff rendering uses simple React components with CSS for syntax highlighting (green/red backgrounds, monospace font). No need for a heavy diff library.

### Feature 2
- No new npm dependencies required. Direct `fetch()` to Claude API. Chat UI is custom React components. No external chat library needed.

---

## Out of Scope (Future)

- **Pane dependency chains**: Linking panes so one auto-triggers when another finishes. Natural extension but not part of this spec.
- **Plan templates**: Pre-built project plans (e.g., "Full-stack app", "API service"). Could be added to the wizard later.
- **Agent auto-detection**: Wizard suggesting agents based on repo analysis (package.json, file structure). v1 relies on the LLM's suggestions based on the conversation.
- **Collaborative wizard**: Multiple users planning together. Single-user for v1.
- **VR wizard**: Running the wizard in VR mode. Desktop/browser only for v1.
