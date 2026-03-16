# Pane UX Improvements: Agent Ordering + New Folder

**Date:** 2026-03-16
**Status:** Design approved, pending implementation plan
**Scope:** Two small UX improvements: reorder agent types with Claude Code as default, add "New Folder" button to directory picker

## Change 1: Agent Type Ordering

### File: `src/lib/agents.ts`

Reorder `AGENT_TYPES` record so Claude Code is first:

1. claude (default)
2. codex
3. gemini
4. aider
5. shell
6. custom

### File: `src/app/(desktop)/terminal/page.tsx`

Change the default agent type state from `'shell'` to `'claude'`:

```typescript
// From:
const [newAgentType, setNewAgentType] = useState('shell');
// To:
const [newAgentType, setNewAgentType] = useState('claude');
```

## Change 2: New Folder in Directory Picker

### File: `src/components/common/dev-directory-picker.tsx`

Add a "New Folder" button in the browse view (between the "Select this folder" button and the subfolder list). When clicked:

1. Shows an inline text input with a "Create" button
2. On submit, calls `POST /api/folders` with `{ parent: data.current, name: inputValue }`
3. On success, navigates into the new folder and selects it
4. On error, shows inline error message

The button only appears in browse mode (not in the dev directory list view).

### File: `src/app/api/folders/route.ts`

Add a POST handler alongside the existing GET:

```typescript
export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  const config = readConfig(user);
  const body = await request.json();
  const { parent, name } = body;

  // Validate parent is within allowed dev directories
  // Validate name (no path separators, no dots-only, reasonable length)
  // Create directory with fs.mkdirSync
  // Return { path: newPath }
}
```

Validation rules:
- `parent` must be within an allowed dev directory (same check as GET)
- `name` must not contain path separators (`/`, `\`)
- `name` must not be `.` or `..`
- `name` must be 1-255 characters
- Directory must not already exist (return 409)

## Files Changed

```
Modified:
├── src/lib/agents.ts                           — Reorder agents
├── src/app/(desktop)/terminal/page.tsx          — Default to 'claude'
├── src/components/common/dev-directory-picker.tsx — Add New Folder button + UI
├── src/app/api/folders/route.ts                 — Add POST handler
```
