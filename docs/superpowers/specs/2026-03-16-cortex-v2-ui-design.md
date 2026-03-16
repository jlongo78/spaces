# Cortex v2 UI Components

**Date:** 2026-03-16
**Status:** Design approved, pending implementation plan
**Scope:** Three UI additions for Cortex v2: entity graph visualization, enhanced knowledge cards, and context assembly dashboard

## Overview

Add a dedicated `/cortex` page to Spaces with four tabs (Graph, Knowledge, Context, Settings) plus enhancements to the existing right-side panel. The graph uses a canvas-based force layout for interactive exploration. Knowledge cards gain v2 field display (scope, sensitivity, evidence, origin). A context assembly tab lets users inspect how the retrieval engine works.

### Design Principles

- Follow existing dark theme and Tailwind patterns (no component library)
- All data from existing API endpoints — no new backend
- One new npm dependency: `force-graph` for canvas rendering
- Progressive enhancement — v1 data renders fine, v2 fields show when present

## Component 1: Entity Graph Page

### Route: `/app/(desktop)/cortex/page.tsx`

Full-page layout with tab navigation. The "Cortex" icon (Brain from Lucide) is added to the sidebar below existing nav items, gated by `useTier().hasCortex`.

### Tab Bar

Four tabs across the top: **Graph** | **Knowledge** | **Context** | **Settings**

Right-aligned stats in the tab bar: entity count, edge count, knowledge unit count (from `/api/cortex/status` + `/api/cortex/graph/entities`).

### Graph Tab (default)

Two-column layout:

**Left: Force Graph Canvas (~70% width)**
- Renders via `force-graph` npm package (canvas-based, handles 1000+ nodes)
- Nodes colored and shaped by entity type:
  - Person: circle, purple (#7c3aed)
  - Team/Project: rounded rectangle, green (#10b981)
  - System: diamond, amber (#f59e0b)
  - Topic: small circle, cyan (#06b6d4)
  - Department/Organization: larger rounded rect, blue (#3b82f1)
- Edges rendered as lines, opacity based on weight
- Interactions: drag nodes, zoom (scroll), pan (drag background), click to select
- Overlay controls: zoom +/-, recenter button (bottom-left)
- Legend overlay (top-right): shows shape/color mapping

**Right: Detail Panel (~30% width, 260px min)**

When no node selected: shows graph stats summary (entity counts by type, edge counts by relation).

When a node is selected:
- Entity header: icon + name + type + metadata (role, email, etc.)
- Relationships section: list of edges from/to this entity, each showing relation type, target name, weight
- Related Knowledge section: knowledge units linked to this entity (via entity_links or scope), shown as mini knowledge cards
- Actions: "Add Edge" button (opens simple form), "Delete Entity" with confirmation

### Data Fetching

```
GET /api/cortex/graph/entities → all nodes
GET /api/cortex/graph/edges?from={id} → edges for selected node
GET /api/cortex/graph/edges?to={id} → edges to selected node
GET /api/cortex/search?q=&layer=personal&limit=5 → related knowledge (when node selected)
GET /api/cortex/status → stats for tab bar
```

For the graph canvas, fetch ALL entities and ALL edges on mount (the graph is small — hundreds of nodes, not millions). Build the node/link arrays for force-graph from the API response.

To get all edges, add a new lightweight endpoint or use a query parameter:
```
GET /api/cortex/graph/edges?all=true → all edges (for graph rendering)
```

## Component 2: Enhanced Knowledge Cards

### Modify: `src/components/cortex/knowledge-card.tsx`

The existing card shows: type badge, age, text, confidence bar, delete button.

Add v2 fields (displayed only when present — backward compatible with v1 data):

**Badge row (top):**
- Existing type badge (decision, error_fix, etc.)
- NEW: Sensitivity badge — color-coded:
  - public: green (#10b981)
  - internal: blue (#6366f1)
  - restricted: amber (#f59e0b)
  - confidential: red (#ef4444)
- NEW: Scope badge — shows scope level (personal, team, department, organization) in muted purple

**Attribution row (below text):**
- Creator: `by {origin.creator_entity_id}` (strip "person-" prefix for display)
- Source: `via {origin.source_type}` (conversation, git_commit, document, etc.)
- Corroborations: `{corroborations} corroborations` in green if > 0
- Contradictions: `{contradiction_refs.length} contested` in amber if > 0

**Evidence bar (replaces confidence bar):**
- If `evidence_score` is present, show it instead of `confidence`
- Label: "0.72 evidence" instead of "85% confidence"
- Same visual style (horizontal bar with fill)

**Conflict indicator:**
- If `contradiction_refs.length > 0`, show an amber warning icon and "Contested" text

All new fields use optional chaining — if undefined, the row/badge simply doesn't render.

## Component 3: Context Assembly Tab

### Tab content within `/cortex` page

A query input at the top. User types a question and clicks "Analyze" (or presses Enter). The tab calls `GET /api/cortex/context/?q={query}&limit=5` and displays the full pipeline breakdown.

**Layout (top to bottom):**

1. **Query input** — text field + Analyze button

2. **Pipeline summary cards** (3 columns):
   - Intent card: detected intent name (color-coded), confidence score
   - Entities card: list of resolved entities with type badges
   - Timing card: total ms (large number), breakdown (intent, entity, search)

3. **Source weights** — horizontal bars showing each source's computed weight. Three bars: Personal, Team, Org. Bar fill proportional to weight, numeric label.

4. **Results list** — ranked knowledge units with:
   - Type badge
   - Text snippet
   - Relevance score (right-aligned)
   - Source attribution

5. **Conflict callout** (if any) — amber box showing conflicting pairs

6. **Raw context preview** — collapsible section showing the `<cortex-context>` XML that would be injected into a Claude prompt

### Data Fetching

Single API call: `GET /api/cortex/context/?q={query}&limit=5`

Response contains everything needed:
```typescript
{
  results: ScoredKnowledge[]
  context: string          // pre-formatted XML
  intent: { intent, confidence, biases }
  conflicts: number
  timing: { intentMs, entityMs, searchMs, totalMs }
}
```

## Component 4: Existing Panel Enhancement

### Modify: `src/components/cortex/cortex-panel.tsx`

Minimal changes to the existing right-side panel:

1. Add "Open full view" link at the top → navigates to `/cortex` using Next.js router
2. Replace `KnowledgeCard` import to use the enhanced version (same component, just has new optional fields)
3. No layout changes — panel stays at 384px width with existing tabs

## Component 5: Sidebar Navigation

### Modify: `src/components/layout/sidebar.tsx`

Add a "Cortex" nav item to the sidebar:
- Icon: Brain from lucide-react (already used by CortexIndicator)
- Position: after existing nav items (Terminal, Sessions, etc.)
- Route: `/cortex`
- Gated by `useTier().hasCortex`
- Active state: purple background when on `/cortex` route

The existing CortexIndicator (bottom of sidebar) remains — it shows the knowledge count badge and toggles the right panel.

## New API Endpoint

### `GET /api/cortex/graph/edges?all=true`

Modify the existing edges route to support an `all=true` parameter that returns all edges without requiring a `from` or `to` filter. This is needed for the graph canvas to render the full graph on mount.

When `all=true`:
- Query all edges from the entity graph
- Return `{ edges: Edge[] }`
- No pagination needed (graph is small)

## File Structure

```
New files:
├── src/app/(desktop)/cortex/page.tsx          — Main /cortex page with tabs
├── src/components/cortex/entity-graph.tsx      — Force graph canvas component
├── src/components/cortex/entity-detail.tsx     — Right-side entity detail panel
├── src/components/cortex/context-tab.tsx       — Context assembly tab content
├── src/components/cortex/knowledge-tab.tsx     — Knowledge list tab (reuses enhanced cards)

Modified files:
├── src/components/cortex/knowledge-card.tsx    — Add v2 field display
├── src/components/cortex/cortex-panel.tsx      — Add "Open full view" link
├── src/components/layout/sidebar.tsx           — Add Cortex nav item
├── src/app/api/cortex/graph/edges/route.ts    — Support all=true parameter
```

## npm Dependency

```
force-graph: ^1.44.0
```

Canvas-based force-directed graph renderer. ~30KB gzipped. Wraps d3-force with a Canvas/WebGL renderer. Supports zoom, drag, click, hover out of the box. No SSR issues — component will use `dynamic()` import with `ssr: false`.

## Success Criteria

- Entity graph renders all entities and edges with correct colors/shapes
- Clicking a node shows its relationships and related knowledge
- Knowledge cards show v2 fields when present, degrade gracefully for v1 data
- Context tab shows full pipeline breakdown (intent, entities, weights, timing, results)
- All within existing dark theme, no visual inconsistencies
- Page loads in <1s, graph interaction is smooth (60fps)
