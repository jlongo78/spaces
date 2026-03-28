# Dockview Pane Layout — Implementation Plan

**Status:** Shelved — ready to implement when prioritized
**Date:** 2026-03-27

## Goal

Replace the current fixed CSS grid / react-resizable-panels layout with Dockview, a full IDE-like dock layout manager. Users should be able to drag panes to snap into positions, dynamically restructure layouts, and resize splits freely.

## Current State

- Panes render in a fixed grid (2 cols for 2-4 panes, 3 cols for 5+)
- `react-resizable-panels` adds resizable dividers between pre-defined rows/columns
- `@dnd-kit` handles drag-to-reorder within the grid
- Minimize sends panes to a bottom dock bar
- Maximize takes a single pane full-screen
- Popout opens a pane in a new browser window
- `sortOrder`, `gridCol`, `gridRow` fields exist in the DB but gridCol/gridRow are unused

## Desired Behavior

- Drag a pane header to the left edge → snaps to fill the entire left half
- Drag next to another pane → they split that space (50/50)
- Drag to a tab bar → panes stack as tabs in the same group
- Resize any split by dragging the divider
- Minimize → panel goes to a bottom dock tray
- Floating panels (detached, draggable windows within the workspace)
- Layout saves/restores per workspace

## Library: Dockview

- **Package:** `dockview` + `dockview-react`
- **Version:** v5.1.0 (released 2026-03-04)
- **Zero dependencies**, React 19 compatible, Next.js 16 compatible
- **Docs:** https://dockview.dev/
- **GitHub:** https://github.com/mathuo/dockview

## Implementation Steps

### Step 1: Core Integration
- Install `dockview` and `dockview-react`
- Remove `react-resizable-panels` (replaced entirely)
- Remove current CSS grid layout from terminal `page.tsx`
- Remove `ResizablePaneGrid` component
- Create a `DockviewReact` wrapper that renders existing `TerminalPane` components as dockview panels
- Register a `terminal` panel component that wraps `TerminalPane`
- Wire `onReady` to add panels from the existing `panes` state

### Step 2: Pane Operations
- Wire `onClose` → dockview's `removePanel()`
- Wire minimize → dockview's panel visibility or custom bottom tray
- Wire maximize → dockview's `maximizeGroup()` / `exitMaximizedGroup()`
- Wire popout → dockview's `addFloatingGroup()` or existing popout window logic
- Remove `@dnd-kit` (dockview handles drag natively)
- Keep the drag handle (`GripVertical`) or rely on dockview's built-in header drag

### Step 3: Layout Persistence
- Serialize layout via `dockviewApi.toJSON()` on layout change
- Store serialized layout in the workspace DB (new `layout` column or separate table)
- Restore layout on workspace load via `dockviewApi.fromJSON(savedLayout)`
- Handle pane additions/removals that happen outside dockview (e.g., new pane from "Add Pane" form)

### Step 4: Styling
- Apply dark theme matching existing zinc/indigo palette
- Style dockview tabs to match current pane title bars (color dot, agent badge, etc.)
- Style resize handles to match current divider aesthetics
- Handle the minimized pane dock at the bottom

## Files Affected

| File | Change |
|------|--------|
| `src/app/(desktop)/terminal/page.tsx` | Major rewrite — replace grid with DockviewReact |
| `src/components/terminal/terminal-pane.tsx` | Remove `dragHandleProps`, adapt to dockview panel lifecycle |
| `src/lib/db/queries.ts` | Add workspace layout storage (optional column) |
| `src/lib/db/schema.ts` | Migration for layout column if needed |
| `src/app/(desktop)/terminal/remote/[nodeId]/[workspaceId]/page.tsx` | Same treatment for remote workspaces |
| `package.json` | Add dockview, remove react-resizable-panels and @dnd-kit |

## Risk / Complexity

- **High** — this touches the core terminal page rendering, every pane lifecycle operation, and layout persistence
- Dockview has its own panel lifecycle — need to bridge between React state (`panes` array) and dockview's internal model
- Terminal xterm.js instances need to survive layout changes (dockview may unmount/remount components on drag)
- Remote workspace page needs the same treatment
- Mobile layout (Quest, phone) may need a separate simpler path since dockview is desktop-oriented

## Dependencies to Remove

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`
- `react-resizable-panels`

## Notes

- The `SortablePane` wrapper component and `ResizablePaneGrid` component (added 2026-03-27) are intermediate solutions that will be replaced entirely by dockview
- The minimize dock at the bottom can remain as a simple React component outside dockview, or be integrated as a dockview "waterfall" panel group
