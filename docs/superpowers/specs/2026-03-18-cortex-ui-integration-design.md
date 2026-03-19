# Cortex UI Integration — Design Spec

> Integrate new `@spaces/cortex` engine features into the Spaces UI.
> Covers: curation workflow, marketplace, quality dashboard, domain context, sensitivity display.

---

## Decisions

- **Tab structure**: 6 tabs — Dashboard (enhanced), Graph (unchanged), Knowledge (merged with Context), Curation (new), Marketplace (new), Settings (enhanced)
- **Curation UX**: Horizontal pipeline bar (Seed → Assess → Review → Refine → Publish) with focused content area below
- **Marketplace UX**: Browse-first card grid scanning `~/.spaces/cortex/marketplace/` for `.cortexpack` files
- **Workspace scoping**: Curation tab has a workspace selector dropdown at the top (no "current workspace" dependency)
- **Marketplace source**: Directory scan for now; structure supports future remote registry

---

## 1. Tab Reorganization

### Current (5 tabs)
Dashboard | Graph | Knowledge | Context | Settings

### New (6 tabs)
Dashboard | Graph | Knowledge | Curation | Marketplace | Settings

**Knowledge tab** absorbs the old Context tab's query analyzer as a section below the knowledge browser. The standalone Context tab is removed.

### File: `src/app/(desktop)/cortex/page.tsx`

- Remove `ContextTab` import and tab entry
- Add `CurationTab` and `MarketplaceTab` imports
- Merge context functionality into `KnowledgeTab` (add a "Query Analyzer" collapsible section at the bottom)
- Update `Tab` type to `'dashboard' | 'graph' | 'knowledge' | 'curation' | 'marketplace' | 'settings'`

---

## 2. Dashboard Enhancements

### File: `src/components/cortex/cortex-dashboard.tsx`

Add two new sections between the existing stat cards and lobe breakdown:

**Coverage Score stat card** (replaces Graph stat card in top row — graph stats move to Graph tab):
- Calls `GET /api/cortex/status` which already returns lobe data
- New API: workspace-scoped assess endpoint (or aggregate from status)
- Shows coverage score (0–1) with color coding: <0.3 red, 0.3–0.7 amber, >0.7 green
- Sub-label: "X% distilled"
- Top row stays 4 cards: Knowledge Units | Coverage Score | Distillation | Storage

**Prerequisite**: Extract `TYPE_COLORS` and `SENSITIVITY_COLORS` from `knowledge-card.tsx` into a shared `src/components/cortex/constants.ts` file. Both `knowledge-card.tsx` and `context-tab.tsx` currently define their own copies. The dashboard and curation tab will also need them.

**Type Distribution chart** (new panel, left side of 2-col grid):
- Bar chart using existing `BarChart` component
- Shows count per knowledge type: decision, pattern, preference, error_fix, conversation, etc.
- Color-coded per type (import `TYPE_COLORS` from `constants.ts`)

**Lobe Health panel** (new panel, right side of 2-col grid):
- Stale count (units with stale_score > 0.5)
- Average confidence
- Top accessed unit (text preview)
- Sensitivity breakdown: counts per level (public/internal/restricted/confidential) as inline badges

### API changes needed

`GET /api/cortex/status` — extend response to include:
```typescript
{
  // existing fields...
  quality?: {
    coverage_score: number;
    type_distribution: Record<string, number>;
    avg_confidence: number;
    stale_count: number;
    sensitivity_counts: Record<string, number>;
    top_accessed: Array<{ text: string; type: string; access_count: number }>;
  };
}
```

This calls `assessLobe()` from the addon for the aggregate view. The status route already gathers lobe stats — extend it to run the assess pass when the addon supports it.

---

## 3. Knowledge Tab (Merged)

### File: `src/components/cortex/knowledge-tab.tsx`

Add a collapsible "Query Analyzer" section at the bottom of the existing knowledge browser. This section contains the content that was previously in `context-tab.tsx`:

- Text input for query
- Results display showing matched knowledge with relevance scores
- Intent detection display (if context engine is available)
- Entity extraction display

The existing knowledge browser (search, filter by type/layer, delete) remains the primary content.

### File changes
- `context-tab.tsx` — delete after merging its query analyzer content into `knowledge-tab.tsx`. No reason to keep an orphaned file.

---

## 4. Curation Tab (New)

### File: `src/components/cortex/curation-tab.tsx`

**Layout:**
- Top: Workspace selector dropdown (fetches workspace list from `GET /api/workspaces` — returns flat array of `{ id, name, color, ... }`)
- Below: Horizontal pipeline step bar
- Below: Content area for active step

**Loading/error states**: Each step shows a spinner overlay while its API call is in progress. Errors display in a red banner below the step content with the error message. The Refine step specifically checks for LLM API key availability before enabling the button (shows a warning with link to Settings if missing). The Seed and Refine steps can be long-running — the button disables and shows "Processing..." until the POST returns.

**Pipeline steps:**

#### Step 1: Seed
- Textarea for pasting document content (or file upload area)
- Format selector: markdown / plaintext / csv / auto
- Source reference input (filename/URL for provenance)
- "Distill after seeding" checkbox (default: true)
- "Seed" button → calls `POST /api/cortex/curation/seed`
- Result display: chunks created, chunks skipped, errors

#### Step 2: Assess
- "Run Assessment" button → calls `GET /api/cortex/curation/assess?workspace_id=X`
- Results display:
  - Coverage score with color-coded gauge
  - Type distribution bar chart
  - Stale count
  - Average confidence
  - Top accessed units list

#### Step 3: Review
- Topic input field + "Review" button
- Results grouped by knowledge type (accordion sections)
- Each result shows: text, confidence, similarity score
- Limit selector (10/25/50)
- Calls `GET /api/cortex/curation/review?workspace_id=X&topic=Y`

#### Step 4: Refine
- Domain context textarea (pre-populated from workspace's LobeConfig if available)
- Checkboxes for which distillation passes to run (decisions/patterns/preferences/error_fixes)
- "Refine" button → calls `POST /api/cortex/curation/refine`
- Result display: source units found, old distilled purged, new units created, errors
- Warning if no LLM API key configured

#### Step 5: Publish
- Form fields: name, author, description, tags (chip input), version (semver), license selector
- Preview count slider (1–10, default 3)
- "Publish" button → calls `POST /api/cortex/curation/publish`
- Result display:
  - Output file path
  - Units before/after PII scrubbing
  - Quality assessment summary
  - Warning banner if coverage_score < 0.3

### New API routes needed

These proxy to the addon's MCP tool handlers:

| Route | Method | Maps to |
|-------|--------|---------|
| `/api/cortex/curation/seed` | POST | `cortex_seed` |
| `/api/cortex/curation/assess` | GET | `cortex_assess` |
| `/api/cortex/curation/review` | GET | `cortex_review` |
| `/api/cortex/curation/refine` | POST | `cortex_refine` |
| `/api/cortex/curation/publish` | POST | `cortex_publish` |

Each route follows the existing pattern: auth check → get cortex instance → call handler → return JSON.

---

## 5. Marketplace Tab (New)

### File: `src/components/cortex/marketplace-tab.tsx`

**Layout:**
- Top: "Import .cortexpack" button (file picker) + directory path display
- Below: Card grid of available packs

**Pack card:**
- Name (large), author, version
- Description (2-line clamp)
- Tags as chips
- Quality score badge (coverage_score with color)
- Unit count
- Preview samples (expandable — show 2-3 sample knowledge units)
- "Import" button → opens import dialog

**Import dialog (modal):**
- Target layer selector (personal/workspace/team)
- If workspace: workspace selector dropdown
- Merge strategy: append / merge / replace (radio buttons)
- Re-embed checkbox (default: false, with note about cost)
- If pack has `domain_context`: checkbox "Apply domain context to target workspace"
- Import button → calls `POST /api/cortex/import`
- Progress display during import

**Pack source:**
- Scan `~/.spaces/cortex/marketplace/` directory
- Read each `.cortexpack` file's manifest (tar header extraction without full unpack)
- Cache manifests for display

### New API routes needed

| Route | Method | Description |
|-------|--------|-------------|
| `/api/cortex/marketplace/browse` | GET | Scan marketplace dir, return manifests |
| `/api/cortex/marketplace/preview?file=NAME` | GET | Extract preview samples from a named pack |

**Browse response contract:**
```typescript
interface BrowseResponse {
  packs: Array<{
    filename: string;           // e.g. "cfb-power-plants-v1.0.0.cortexpack"
    manifest: {
      version: string;
      exportDate: string;
      unitCount: number;
      marketplace?: {
        name: string;
        author: string;
        description: string;
        tags: string[];
        packageVersion: string;
        license: string;
        domain_context?: string;
        quality: {
          coverage_score: number;
          avg_confidence: number;
          type_distribution: Record<string, number>;
          total_units: number;
        };
        preview: Array<{ text: string; type: string }>;
      };
    };
  }>;
  directory: string;  // the scanned path
}
```

If `~/.spaces/cortex/marketplace/` does not exist, the browse API creates it and returns `{ packs: [], directory }`. Packs without marketplace metadata (legacy v1 format) are still listed but show filename, unit count, and export date only.

**Import route changes**: The existing `POST /api/cortex/import` needs updating to accept `workspace_id` and `re_embed` as form fields (currently hardcodes `reEmbed: true`).

**Publish output**: `cortex_publish` writes the `.cortexpack` to `~/.spaces/cortex/marketplace/` so it appears immediately in the browse tab.

---

## 6. Settings Enhancements

### File: `src/components/cortex/lobe-settings.tsx`

Add a "Domain Context" textarea below the tags section:

```
Domain Context
[textarea — 4 rows, placeholder: "Describe the domain expertise this lobe should focus on..."]
(hint text: "Injected into distillation prompts for better extraction. E.g. 'This workspace covers CFB power plant engineering.'")
```

Save via the existing `PUT /api/cortex/lobes/{workspaceId}` endpoint, adding `domain_context` to the `LobeConfig` payload.

**Type change required**: Add `domain_context?: string` to the `LobeConfig` interface in `src/lib/cortex/types.ts`. The addon already supports this field — the host-side type just needs to match. The `serializeLobeConfig` function uses spread, so the new field passes through without logic changes. No database migration needed — lobe config is stored as JSON in the workspaces table's `lobe_config` column.

### File: `src/components/cortex/cortex-settings.tsx`

No structural changes. The existing settings (enable/disable, API keys, embedding, injection budget, distillation, federation, bootstrap) remain as-is.

---

## 7. Component Summary

### New files
| File | Type | Description |
|------|------|-------------|
| `src/components/cortex/curation-tab.tsx` | Component | Curation pipeline with 5 steps |
| `src/components/cortex/marketplace-tab.tsx` | Component | Browse/import cortexpack cards |
| `src/components/cortex/marketplace-card.tsx` | Component | Individual pack card display |
| `src/components/cortex/import-dialog.tsx` | Component | Import options modal |
| `src/app/api/cortex/curation/seed/route.ts` | API | Proxy to cortex_seed |
| `src/app/api/cortex/curation/assess/route.ts` | API | Proxy to cortex_assess |
| `src/app/api/cortex/curation/review/route.ts` | API | Proxy to cortex_review |
| `src/app/api/cortex/curation/refine/route.ts` | API | Proxy to cortex_refine |
| `src/app/api/cortex/curation/publish/route.ts` | API | Proxy to cortex_publish |
| `src/app/api/cortex/marketplace/browse/route.ts` | API | Scan marketplace dir |
| `src/app/api/cortex/marketplace/preview/route.ts` | API | Extract pack preview |

### New shared files
| File | Type | Description |
|------|------|-------------|
| `src/components/cortex/constants.ts` | Constants | Shared `TYPE_COLORS`, `SENSITIVITY_COLORS` extracted from knowledge-card |

### Modified files
| File | Change |
|------|--------|
| `src/app/(desktop)/cortex/page.tsx` | 6-tab layout, remove Context tab, add Curation + Marketplace |
| `src/components/cortex/cortex-dashboard.tsx` | Add coverage score, type distribution, lobe health panels |
| `src/components/cortex/knowledge-tab.tsx` | Add query analyzer section (from context-tab) |
| `src/components/cortex/knowledge-card.tsx` | Import `TYPE_COLORS` from constants.ts instead of local definition |
| `src/components/cortex/lobe-settings.tsx` | Add domain_context textarea |
| `src/lib/cortex/types.ts` | Add `domain_context?: string` to `LobeConfig` interface |
| `src/app/api/cortex/status/route.ts` | Extend response with quality assessment data |
| `src/app/api/cortex/import/route.ts` | Accept `workspace_id` and `re_embed` form fields |

### Deleted files
| File | Reason |
|------|--------|
| `src/components/cortex/context-tab.tsx` | Merged into knowledge-tab.tsx |

### Unchanged files
| File | Reason |
|------|--------|
| `cortex-indicator.tsx` | Already shows status badge — no changes needed |
| `cortex-settings.tsx` | Existing settings cover all config — no changes needed |
| `injection-badge.tsx` | Already shows injection count — no changes needed |
| `knowledge-card.tsx` | Already has sensitivity, evidence, contradiction badges — no changes needed |
| `cortex-panel.tsx` | Sidebar search panel — no changes needed |
| `entity-graph.tsx` | Graph visualization — no changes needed |

---

## 8. Design Patterns

All new components follow existing patterns:
- `'use client'` directive
- `api()` helper for URL construction
- `fetch()` for API calls (no axios/swr)
- Tailwind classes matching existing dark theme (bg-white/[0.02], border-white/[0.06], text-gray-400, etc.)
- `lucide-react` for icons
- No external UI libraries
- Optimistic updates where appropriate
- Loading/error states with consistent styling

---

## 9. Future Considerations (Not in Scope)

- **Remote marketplace registry** — cloud-hosted pack discovery/download. Current design scans local directory; the card grid + manifest structure supports swapping in a remote source later.
- **Pack ratings/reviews** — would require a central registry.
- **Automatic curation suggestions** — "your coverage is low, try seeding X" — could be added to the assess step later.
- **Real-time distillation progress** — WebSocket/SSE for long-running refine operations. Current design polls or waits.
