# Cortex UI Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate @spaces/cortex curation, marketplace, quality dashboard, and domain context features into the Spaces UI with 6-tab Cortex page layout.

**Architecture:** Extend existing Cortex page (5 tabs → 6 tabs), add API routes that proxy to addon MCP tool handlers, build new UI components following established patterns (client components, `api()` helper, Tailwind dark theme, lucide-react icons).

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-18-cortex-ui-integration-design.md`

---

### Task 1: Extract Shared Constants

**Files:**
- Create: `src/components/cortex/constants.ts`
- Modify: `src/components/cortex/knowledge-card.tsx:6-16`
- Modify: `src/components/cortex/context-tab.tsx:18-28`

- [ ] **Step 1: Create the shared constants file**

```typescript
// src/components/cortex/constants.ts
export const TYPE_COLORS: Record<string, string> = {
  decision: 'bg-blue-500/20 text-blue-400',
  preference: 'bg-pink-500/20 text-pink-400',
  pattern: 'bg-green-500/20 text-green-400',
  error_fix: 'bg-amber-500/20 text-amber-400',
  context: 'bg-gray-500/20 text-gray-400',
  code_pattern: 'bg-cyan-500/20 text-cyan-400',
  command: 'bg-orange-500/20 text-orange-400',
  conversation: 'bg-slate-500/20 text-slate-400',
  summary: 'bg-violet-500/20 text-violet-400',
};

export const SENSITIVITY_COLORS: Record<string, string> = {
  public: 'bg-green-500/20 text-green-400',
  internal: 'bg-indigo-500/20 text-indigo-400',
  restricted: 'bg-amber-500/20 text-amber-400',
  confidential: 'bg-red-500/20 text-red-400',
};

export const INTENT_COLORS: Record<string, string> = {
  debugging: 'text-red-400',
  architecture: 'text-blue-400',
  onboarding: 'text-green-400',
  policy: 'text-purple-400',
  'how-to': 'text-amber-400',
  review: 'text-pink-400',
  security: 'text-red-500',
  general: 'text-gray-400',
};
```

- [ ] **Step 2: Update knowledge-card.tsx to import from constants**

Replace the local `TYPE_COLORS` and `SENSITIVITY_COLORS` definitions (lines 6-23) with:
```typescript
import { TYPE_COLORS, SENSITIVITY_COLORS } from './constants';
```

- [ ] **Step 3: Update context-tab.tsx to import from constants**

Replace the local `INTENT_COLORS` and `TYPE_COLORS` definitions (lines 7-28) with:
```typescript
import { INTENT_COLORS, TYPE_COLORS } from './constants';
```

- [ ] **Step 4: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds with no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/cortex/constants.ts src/components/cortex/knowledge-card.tsx src/components/cortex/context-tab.tsx
git commit -m "refactor(cortex): extract shared color constants"
```

---

### Task 2: Add domain_context to LobeConfig Type

**Files:**
- Modify: `src/lib/cortex/types.ts:23-38`

- [ ] **Step 1: Add domain_context field**

In `src/lib/cortex/types.ts`, add `domain_context?: string;` to the `LobeConfig` interface after `isPrivate`:

```typescript
export interface LobeConfig {
  tags: string[];
  excludeTags: string[];
  excludedFrom: number[];
  subscriptions: string[];
  private: boolean;
  isPrivate?: boolean;
  domain_context?: string;
}
```

No change to `DEFAULT_LOBE_CONFIG` — the field is optional and defaults to undefined.

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/lib/cortex/types.ts
git commit -m "feat(cortex): add domain_context to LobeConfig type"
```

---

### Task 3: Add Domain Context to Lobe Settings UI

**Files:**
- Modify: `src/components/cortex/lobe-settings.tsx`

- [ ] **Step 1: Add domain context state and textarea**

After the tags section (after the closing `</div>` of the tags `space-y-1.5` div, around line 155), add:

```tsx
{/* Domain context */}
<div className="space-y-1.5">
  <div className="text-[10px] text-zinc-500">
    Domain Context
    <span className="text-zinc-700 ml-1">— injected into distillation prompts for better extraction</span>
  </div>
  <textarea
    value={config.domain_context || ''}
    onChange={e => save({ domain_context: e.target.value })}
    placeholder="Describe the domain expertise this lobe should focus on. E.g. 'This workspace covers CFB power plant engineering.'"
    rows={3}
    disabled={saving}
    className="w-full px-2 py-1.5 bg-zinc-800 border border-zinc-700 rounded text-[11px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 resize-y disabled:opacity-50"
  />
</div>
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/components/cortex/lobe-settings.tsx
git commit -m "feat(cortex): add domain context textarea to lobe settings"
```

---

### Task 4: Extend Status API with Quality Data

**Files:**
- Modify: `src/app/api/cortex/status/route.ts`

- [ ] **Step 1: Add quality assessment to status response**

After the `graphStats` calculation (around line 114) and before the `return NextResponse.json(...)`, add:

```typescript
    // Quality assessment (aggregate across all lobes)
    let quality = null;
    try {
      const addon = (await import('@/lib/cortex')).getCortexAddon?.();
      if (addon?.assessLobe) {
        // Get first workspace lobe for representative quality
        const wsKeys = Object.keys(lobes).filter(k => k.startsWith('workspace/'));
        if (wsKeys.length > 0) {
          const wsId = parseInt(wsKeys[0].split('/')[1], 10);
          quality = await addon.assessLobe(cortex.store, wsId);
        }
      }
    } catch { /* addon doesn't support assess yet */ }

    // Fallback: build quality from available data if addon doesn't have assessLobe
    if (!quality) {
      // Compute type distribution and sensitivity counts from browse data
      const allUnits: any[] = [];
      for (const layerKey of Object.keys(lobes)) {
        try {
          const items = await cortex.store.browse(layerKey, 100);
          allUnits.push(...items);
        } catch { /* skip */ }
      }
      if (allUnits.length > 0) {
        const typeDist: Record<string, number> = {};
        const sensCounts: Record<string, number> = {};
        let confSum = 0;
        let staleCount = 0;
        for (const u of allUnits) {
          typeDist[u.type] = (typeDist[u.type] || 0) + 1;
          const sens = u.sensitivity || 'internal';
          sensCounts[sens] = (sensCounts[sens] || 0) + 1;
          confSum += u.confidence ?? 0;
          if ((u.stale_score ?? 0) > 0.5) staleCount++;
        }
        const distilled = (typeDist.decision || 0) + (typeDist.pattern || 0) + (typeDist.preference || 0) + (typeDist.error_fix || 0);
        quality = {
          coverage_score: allUnits.length > 0 ? distilled / allUnits.length : 0,
          type_distribution: typeDist,
          avg_confidence: allUnits.length > 0 ? confSum / allUnits.length : 0,
          stale_count: staleCount,
          sensitivity_counts: sensCounts,
          top_accessed: allUnits
            .filter(u => (u.access_count ?? 0) > 0)
            .sort((a, b) => (b.access_count ?? 0) - (a.access_count ?? 0))
            .slice(0, 3)
            .map(u => ({ text: u.text?.slice(0, 120), type: u.type, access_count: u.access_count })),
        };
      }
    }
```

Then update the return statement to include `quality`:

```typescript
    return NextResponse.json({
      enabled: true,
      status: 'healthy',
      embedding_provider: cortex.embedding.name,
      embedding_dimensions: cortex.embedding.dimensions,
      distillation: config.ingestion?.distillation ?? false,
      lobes,
      totalCount,
      totalSizeBytes,
      usage,
      graph: graphStats,
      quality,
    });
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cortex/status/route.ts
git commit -m "feat(cortex): add quality assessment data to status API"
```

---

### Task 5: Enhance Dashboard with Quality Panels

**Files:**
- Modify: `src/components/cortex/cortex-dashboard.tsx`

- [ ] **Step 1: Import shared constants**

Add at the top of the file:
```typescript
import { TYPE_COLORS, SENSITIVITY_COLORS } from './constants';
```

- [ ] **Step 2: Update StatusData interface**

Add `quality` to the interface (after line 33):
```typescript
  quality: {
    coverage_score: number;
    type_distribution: Record<string, number>;
    avg_confidence: number;
    stale_count: number;
    sensitivity_counts: Record<string, number>;
    top_accessed: Array<{ text: string; type: string; access_count: number }>;
  } | null;
```

- [ ] **Step 3: Replace Graph stat card with Coverage Score**

Replace the Graph `StatCard` (around line 117-121) with:
```tsx
<StatCard
  label="Coverage"
  value={data.quality ? data.quality.coverage_score.toFixed(2) : '—'}
  sub={data.quality ? `${Math.round(data.quality.coverage_score * 100)}% distilled` : 'no data'}
  color={data.quality
    ? data.quality.coverage_score > 0.7 ? 'text-green-400'
      : data.quality.coverage_score > 0.3 ? 'text-amber-400'
      : 'text-red-400'
    : 'text-gray-500'}
/>
```

- [ ] **Step 4: Add Type Distribution and Lobe Health panels**

After the existing lobe breakdown section (before the distillation detail section), add:

```tsx
{/* Quality panels */}
{data.quality && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
    {/* Type distribution */}
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
      <h3 className="text-xs font-medium text-gray-400 mb-3">Type Distribution</h3>
      <BarChart
        items={Object.entries(data.quality.type_distribution)
          .sort((a, b) => b[1] - a[1])
          .map(([type, count]) => ({
            label: type.replace('_', ' '),
            value: count,
            color: TYPE_HEX[type] || '#7c3aed',
          }))
        }
        maxValue={Math.max(...Object.values(data.quality.type_distribution), 1)}
      />
    </div>

    {/* Lobe health */}
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
      <h3 className="text-xs font-medium text-gray-400 mb-3">Lobe Health</h3>
      <div className="space-y-3">
        <div className="flex justify-between text-[11px]">
          <span className="text-gray-500">Stale units</span>
          <span className={data.quality.stale_count > 10 ? 'text-amber-400' : 'text-gray-300'}>
            {data.quality.stale_count}
          </span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-gray-500">Avg confidence</span>
          <span className="text-gray-300">{data.quality.avg_confidence.toFixed(2)}</span>
        </div>
        {data.quality.top_accessed.length > 0 && (
          <div>
            <div className="text-[10px] text-gray-500 mb-1">Top accessed</div>
            <div className="text-[11px] text-gray-400 truncate">
              &ldquo;{data.quality.top_accessed[0].text}&rdquo;
            </div>
          </div>
        )}
        {data.quality.sensitivity_counts && (
          <div>
            <div className="text-[10px] text-gray-500 mb-1">Sensitivity</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(data.quality.sensitivity_counts).map(([level, count]) => (
                <span key={level} className={`text-[9px] px-1.5 py-0.5 rounded ${SENSITIVITY_COLORS[level] || SENSITIVITY_COLORS.internal}`}>
                  {count} {level}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  </div>
)}
```

Add `TYPE_HEX` as a const inside the component (after the `LOBE_COLORS` array) since BarChart uses inline styles, not Tailwind classes:
```typescript
const TYPE_HEX: Record<string, string> = {
  decision: '#3b82f6', pattern: '#22c55e', preference: '#ec4899',
  error_fix: '#f59e0b', context: '#6b7280', code_pattern: '#06b6d4',
  command: '#f97316', conversation: '#64748b', summary: '#8b5cf6',
};
```

- [ ] **Step 5: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/components/cortex/cortex-dashboard.tsx
git commit -m "feat(cortex): add quality panels to dashboard"
```

---

### Task 6: Merge Context Tab into Knowledge Tab

**Files:**
- Modify: `src/components/cortex/knowledge-tab.tsx`
- Delete: `src/components/cortex/context-tab.tsx`

- [ ] **Step 1: Add query analyzer section to knowledge-tab.tsx**

Add state and imports at the top:
```typescript
import { useState, useCallback, useEffect } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';
import { KnowledgeCard } from './knowledge-card';
import { TYPE_COLORS, INTENT_COLORS } from './constants';
```

Add state for the analyzer:
```typescript
const [analyzerOpen, setAnalyzerOpen] = useState(false);
const [analyzerQuery, setAnalyzerQuery] = useState('');
const [analyzerResult, setAnalyzerResult] = useState<any>(null);
const [analyzerLoading, setAnalyzerLoading] = useState(false);

const handleAnalyze = async () => {
  if (!analyzerQuery.trim()) return;
  setAnalyzerLoading(true);
  try {
    const res = await fetch(api(`/api/cortex/context?q=${encodeURIComponent(analyzerQuery)}&limit=5`));
    if (res.ok) setAnalyzerResult(await res.json());
  } catch {}
  setAnalyzerLoading(false);
};
```

After the knowledge cards `</div>` (end of the scrollable area), add a collapsible Query Analyzer section. Use the full content from `context-tab.tsx` lines 46-170, wrapped in a collapsible container:

```tsx
{/* Query Analyzer */}
<div className="border-t border-white/5 mt-4 pt-4">
  <button
    onClick={() => setAnalyzerOpen(!analyzerOpen)}
    className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 mb-3"
  >
    {analyzerOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
    Query Analyzer
  </button>
  {analyzerOpen && (
    <div className="max-w-2xl">
      {/* Paste the context-tab query input and results display here */}
      {/* Use analyzerQuery/analyzerResult/analyzerLoading state */}
      {/* ... full context-tab content adapted to use analyzer* state variables ... */}
    </div>
  )}
</div>
```

Copy the full JSX body from `context-tab.tsx` (the input, results grid, source weights, results list, conflicts, raw context sections) into the `{analyzerOpen && (...)}` block, replacing `query` → `analyzerQuery`, `result` → `analyzerResult`, `loading` → `analyzerLoading`, `handleAnalyze` stays the same name.

**Do NOT delete `context-tab.tsx` yet** — `page.tsx` still imports it. The file is removed in Task 11 when the page is updated to the 6-tab layout.

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds (context-tab.tsx still exists, page.tsx still imports it)

- [ ] **Step 3: Commit**

```bash
git add src/components/cortex/knowledge-tab.tsx
git commit -m "feat(cortex): add query analyzer section to knowledge tab"
```

---

### Task 7: Create Curation API Routes

**Files:**
- Create: `src/app/api/cortex/curation/seed/route.ts`
- Create: `src/app/api/cortex/curation/assess/route.ts`
- Create: `src/app/api/cortex/curation/review/route.ts`
- Create: `src/app/api/cortex/curation/refine/route.ts`
- Create: `src/app/api/cortex/curation/publish/route.ts`

All routes follow the same pattern: auth check → get cortex → proxy to addon's `handleToolCall`.

All 5 curation routes use `handleToolCall` from `@/lib/cortex/mcp/server` — the same pattern as the existing `/api/cortex/mcp/call` route. This function internally delegates to the addon.

- [ ] **Step 1: Create seed route**

```typescript
// src/app/api/cortex/curation/seed/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { handleToolCall } from '@/lib/cortex/mcp/server';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const result = await handleToolCall('cortex_seed', body, cortex);
    if (result.isError) {
      return NextResponse.json({ error: JSON.parse(result.content[0].text) }, { status: 400 });
    }
    return NextResponse.json(JSON.parse(result.content[0].text));
  });
}
```

- [ ] **Step 2: Create assess route**

```typescript
// src/app/api/cortex/curation/assess/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { handleToolCall } from '@/lib/cortex/mcp/server';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const url = new URL(request.url);
    const workspace_id = parseInt(url.searchParams.get('workspace_id') || '0', 10);
    if (!workspace_id) {
      return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 });
    }

    const result = await handleToolCall('cortex_assess', { workspace_id }, cortex);
    if (result.isError) {
      return NextResponse.json({ error: JSON.parse(result.content[0].text) }, { status: 400 });
    }
    return NextResponse.json(JSON.parse(result.content[0].text));
  });
}
```

- [ ] **Step 3: Create review route**

```typescript
// src/app/api/cortex/curation/review/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { handleToolCall } from '@/lib/cortex/mcp/server';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const url = new URL(request.url);
    const workspace_id = parseInt(url.searchParams.get('workspace_id') || '0', 10);
    const topic = url.searchParams.get('topic') || '';
    const limit = parseInt(url.searchParams.get('limit') || '10', 10);

    if (!workspace_id || !topic) {
      return NextResponse.json({ error: 'workspace_id and topic are required' }, { status: 400 });
    }

    const result = await handleToolCall('cortex_review', { workspace_id, topic, limit }, cortex);
    if (result.isError) {
      return NextResponse.json({ error: JSON.parse(result.content[0].text) }, { status: 400 });
    }
    return NextResponse.json(JSON.parse(result.content[0].text));
  });
}
```

- [ ] **Step 4: Create refine route**

```typescript
// src/app/api/cortex/curation/refine/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { handleToolCall } from '@/lib/cortex/mcp/server';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const result = await handleToolCall('cortex_refine', body, cortex);
    if (result.isError) {
      return NextResponse.json({ error: JSON.parse(result.content[0].text) }, { status: 400 });
    }
    return NextResponse.json(JSON.parse(result.content[0].text));
  });
}
```

- [ ] **Step 5: Create publish route**

```typescript
// src/app/api/cortex/curation/publish/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { handleToolCall } from '@/lib/cortex/mcp/server';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const body = await request.json();
    const result = await handleToolCall('cortex_publish', body, cortex);
    if (result.isError) {
      return NextResponse.json({ error: JSON.parse(result.content[0].text) }, { status: 400 });
    }
    return NextResponse.json(JSON.parse(result.content[0].text));
  });
}
```

- [ ] **Step 6: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/app/api/cortex/curation/
git commit -m "feat(cortex): add curation API routes (seed/assess/review/refine/publish)"
```

---

### Task 8: Create Marketplace API Routes

**Files:**
- Create: `src/app/api/cortex/marketplace/browse/route.ts`
- Create: `src/app/api/cortex/marketplace/preview/route.ts`
- Modify: `src/app/api/cortex/import/route.ts`

- [ ] **Step 1: Create browse route**

```typescript
// src/app/api/cortex/marketplace/browse/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const { spacesDir } = getUserPaths(user);
    const marketDir = path.join(spacesDir, 'cortex', 'marketplace');

    // Create directory if it doesn't exist
    if (!fs.existsSync(marketDir)) {
      fs.mkdirSync(marketDir, { recursive: true });
      return NextResponse.json({ packs: [], directory: marketDir });
    }

    const files = fs.readdirSync(marketDir).filter(f => f.endsWith('.cortexpack'));
    const packs: any[] = [];

    for (const filename of files) {
      try {
        const filePath = path.join(marketDir, filename);
        // Extract manifest.json from the tar.gz without full unpack
        const stdout = execSync(
          `tar -xzf "${filePath}" -O manifest.json 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const manifest = JSON.parse(stdout);
        packs.push({ filename, manifest });
      } catch {
        // Can't read manifest — list it with minimal info
        const stat = fs.statSync(path.join(marketDir, filename));
        packs.push({
          filename,
          manifest: {
            version: 'unknown',
            exportDate: stat.mtime.toISOString(),
            unitCount: 0,
          },
        });
      }
    }

    return NextResponse.json({ packs, directory: marketDir });
  });
}
```

- [ ] **Step 2: Create preview route**

```typescript
// src/app/api/cortex/marketplace/preview/route.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const url = new URL(request.url);
    const filename = url.searchParams.get('file');
    if (!filename) {
      return NextResponse.json({ error: 'file parameter required' }, { status: 400 });
    }

    // Sanitize filename — prevent path traversal
    const safe = path.basename(filename);
    if (!safe.endsWith('.cortexpack')) {
      return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    }

    const { spacesDir } = getUserPaths(user);
    const filePath = path.join(spacesDir, 'cortex', 'marketplace', safe);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
    }

    try {
      // Extract first 5 lines of knowledge.jsonl for preview
      const stdout = execSync(
        `tar -xzf "${filePath}" -O knowledge.jsonl 2>/dev/null | head -5`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      const samples = stdout.trim().split('\n')
        .filter(Boolean)
        .map(line => {
          try { const u = JSON.parse(line); return { text: u.text?.slice(0, 200), type: u.type }; }
          catch { return null; }
        })
        .filter(Boolean);
      return NextResponse.json({ samples });
    } catch {
      return NextResponse.json({ samples: [] });
    }
  });
}
```

- [ ] **Step 3: Update import route to support both FormData uploads and JSON marketplace imports**

Replace the entire `src/app/api/cortex/import/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { importCortexpack } from '@/lib/cortex/portability/importer';
import { getUserPaths } from '@/lib/config';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex) return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });

    const contentType = request.headers.get('content-type') || '';
    let packPath: string;
    let cleanup = false;

    if (contentType.includes('application/json')) {
      // JSON mode: import from marketplace directory by filename
      const body = await request.json();
      const filename = body.marketplace_file;
      if (!filename) {
        return NextResponse.json({ error: 'marketplace_file is required' }, { status: 400 });
      }
      const safe = path.basename(filename);
      const { spacesDir } = getUserPaths(user);
      packPath = path.join(spacesDir, 'cortex', 'marketplace', safe);
      if (!fs.existsSync(packPath)) {
        return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
      }

      const targetLayer = body.target_layer || 'workspace';
      const workspaceId = body.workspace_id;
      const effectiveLayer = targetLayer === 'workspace' && workspaceId
        ? `workspace/${workspaceId}` : targetLayer;

      importCortexpack(packPath, cortex.store, cortex.embedding, {
        targetLayer: effectiveLayer,
        mergeStrategy: (body.merge_strategy || 'merge') as any,
        reEmbed: body.re_embed ?? false,
      });
      return NextResponse.json({ status: 'started' });

    } else {
      // FormData mode: file upload (existing behavior)
      const formData = await request.formData();
      const file = formData.get('file') as File;
      if (!file) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
      }

      const tmpPath = path.join(os.tmpdir(), `cortex-import-${Date.now()}.cortexpack`);
      const bytes = await file.arrayBuffer();
      fs.writeFileSync(tmpPath, Buffer.from(bytes));

      const targetLayer = (formData.get('target_layer') as string) || 'workspace';
      const mergeStrategy = (formData.get('merge_strategy') as string) || 'merge';
      const reEmbed = formData.get('re_embed') === 'true';
      const workspaceId = formData.get('workspace_id') as string | null;
      const effectiveLayer = targetLayer === 'workspace' && workspaceId
        ? `workspace/${workspaceId}` : targetLayer;

      importCortexpack(tmpPath, cortex.store, cortex.embedding, {
        targetLayer: effectiveLayer,
        mergeStrategy: mergeStrategy as any,
        reEmbed,
      }).finally(() => {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      });
      return NextResponse.json({ status: 'started' });
    }
  });
}
```
```

- [ ] **Step 4: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cortex/marketplace/ src/app/api/cortex/import/route.ts
git commit -m "feat(cortex): add marketplace browse/preview APIs, update import route"
```

---

### Task 9: Build Curation Tab Component

**Files:**
- Create: `src/components/cortex/curation-tab.tsx`

- [ ] **Step 1: Create the curation tab with pipeline bar and all 5 steps**

```typescript
// src/components/cortex/curation-tab.tsx
'use client';

import { useState, useEffect } from 'react';
import { Upload, BarChart3, Search, RefreshCw, Package, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { TYPE_COLORS } from './constants';

type Step = 'seed' | 'assess' | 'review' | 'refine' | 'publish';

const STEPS: { key: Step; label: string; icon: any }[] = [
  { key: 'seed', label: 'Seed', icon: Upload },
  { key: 'assess', label: 'Assess', icon: BarChart3 },
  { key: 'review', label: 'Review', icon: Search },
  { key: 'refine', label: 'Refine', icon: RefreshCw },
  { key: 'publish', label: 'Publish', icon: Package },
];

interface Workspace { id: number; name: string; color: string }

export function CurationTab() {
  const [step, setStep] = useState<Step>('seed');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  // Seed state
  const [seedText, setSeedText] = useState('');
  const [seedFormat, setSeedFormat] = useState('auto');
  const [seedSource, setSeedSource] = useState('');
  const [seedDistill, setSeedDistill] = useState(true);

  // Review state
  const [reviewTopic, setReviewTopic] = useState('');
  const [reviewLimit, setReviewLimit] = useState(10);

  // Refine state
  const [domainContext, setDomainContext] = useState('');
  const [refineTypes, setRefineTypes] = useState<string[]>(['decisions', 'patterns', 'preferences', 'error_fixes']);

  // Publish state
  const [pubName, setPubName] = useState('');
  const [pubAuthor, setPubAuthor] = useState('');
  const [pubDesc, setPubDesc] = useState('');
  const [pubTags, setPubTags] = useState('');
  const [pubVersion, setPubVersion] = useState('1.0.0');
  const [pubLicense, setPubLicense] = useState('cc-by');
  const [pubPreviewCount, setPubPreviewCount] = useState(3);

  useEffect(() => {
    fetch(api('/api/workspaces'))
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : data.local || [];
        setWorkspaces(list);
        if (list.length > 0 && !workspaceId) setWorkspaceId(list[0].id);
      })
      .catch(() => {});
  }, []);

  const clearResult = () => { setResult(null); setError(null); };

  const doSeed = async () => {
    if (!seedText.trim() || !workspaceId) return;
    setLoading(true); clearResult();
    try {
      const res = await fetch(api('/api/cortex/curation/seed'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: seedText, format: seedFormat, source_ref: seedSource,
          workspace_id: workspaceId, distill: seedDistill,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || 'Seed failed');
      setResult(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const doAssess = async () => {
    if (!workspaceId) return;
    setLoading(true); clearResult();
    try {
      const res = await fetch(api(`/api/cortex/curation/assess?workspace_id=${workspaceId}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || 'Assess failed');
      setResult(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const doReview = async () => {
    if (!workspaceId || !reviewTopic.trim()) return;
    setLoading(true); clearResult();
    try {
      const params = new URLSearchParams({
        workspace_id: String(workspaceId), topic: reviewTopic, limit: String(reviewLimit),
      });
      const res = await fetch(api(`/api/cortex/curation/review?${params}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || 'Review failed');
      setResult(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const doRefine = async () => {
    if (!workspaceId) return;
    setLoading(true); clearResult();
    try {
      const res = await fetch(api('/api/cortex/curation/refine'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          domain_context: domainContext || undefined,
          types: refineTypes.length > 0 ? refineTypes : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || 'Refine failed');
      setResult(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  const doPublish = async () => {
    if (!workspaceId || !pubName || !pubAuthor) return;
    setLoading(true); clearResult();
    try {
      const res = await fetch(api('/api/cortex/curation/publish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId, author: pubAuthor, name: pubName,
          description: pubDesc, tags: pubTags.split(',').map(t => t.trim()).filter(Boolean),
          version: pubVersion, license: pubLicense, preview_count: pubPreviewCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || data.error || 'Publish failed');
      setResult(data);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-4xl">
      {/* Workspace selector */}
      <div className="flex items-center gap-3 mb-6">
        <label className="text-xs text-gray-500">Workspace</label>
        <select
          value={workspaceId}
          onChange={e => { setWorkspaceId(parseInt(e.target.value, 10)); clearResult(); }}
          className="text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-gray-300"
        >
          {workspaces.map(ws => (
            <option key={ws.id} value={ws.id}>{ws.name}</option>
          ))}
        </select>
      </div>

      {/* Pipeline bar */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = step === s.key;
          return (
            <div key={s.key} className="flex items-center">
              {i > 0 && <div className={`w-8 h-px ${active ? 'bg-purple-500/40' : 'bg-white/[0.06]'}`} />}
              <button
                onClick={() => { setStep(s.key); clearResult(); }}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? 'bg-purple-500/20 border border-purple-500/30 text-purple-400'
                    : 'bg-white/[0.03] border border-white/[0.06] text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {s.label}
              </button>
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Step content */}
      <div className="min-h-[300px]">
        {step === 'seed' && (
          <div className="space-y-4">
            <textarea
              value={seedText}
              onChange={e => setSeedText(e.target.value)}
              placeholder="Paste document content here..."
              rows={8}
              className="w-full text-sm bg-white/5 border border-white/10 rounded-lg p-3 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 resize-y"
            />
            <div className="flex gap-3">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Format</label>
                <select value={seedFormat} onChange={e => setSeedFormat(e.target.value)}
                  className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-300">
                  <option value="auto">Auto-detect</option>
                  <option value="markdown">Markdown</option>
                  <option value="plaintext">Plain text</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-gray-500 block mb-1">Source reference</label>
                <input value={seedSource} onChange={e => setSeedSource(e.target.value)}
                  placeholder="filename.md or URL"
                  className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-300 placeholder-gray-600" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={seedDistill} onChange={e => setSeedDistill(e.target.checked)}
                className="accent-purple-500" />
              Run distillation after seeding
            </label>
            <button onClick={doSeed} disabled={loading || !seedText.trim()}
              className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50">
              {loading ? <><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> Processing...</> : 'Seed Documents'}
            </button>
            {result && (
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 text-xs text-gray-300">
                <div>Chunks created: <span className="text-green-400">{result.chunksCreated}</span></div>
                <div>Chunks skipped: <span className="text-gray-500">{result.chunksSkipped}</span></div>
                {result.errors?.length > 0 && (
                  <div className="text-red-400 mt-1">{result.errors.join(', ')}</div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'assess' && (
          <div className="space-y-4">
            <button onClick={doAssess} disabled={loading}
              className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50">
              {loading ? <><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> Assessing...</> : 'Run Assessment'}
            </button>
            {result && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase">Coverage</div>
                    <div className={`text-xl font-semibold ${
                      result.coverage_score > 0.7 ? 'text-green-400' : result.coverage_score > 0.3 ? 'text-amber-400' : 'text-red-400'
                    }`}>{result.coverage_score?.toFixed(2)}</div>
                  </div>
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase">Total Units</div>
                    <div className="text-xl font-semibold text-white">{result.total_units}</div>
                  </div>
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3">
                    <div className="text-[10px] text-gray-500 uppercase">Stale</div>
                    <div className="text-xl font-semibold text-amber-400">{result.stale_count}</div>
                  </div>
                </div>
                {result.type_distribution && (
                  <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
                    <div className="text-[10px] text-gray-500 uppercase mb-2">Type Distribution</div>
                    <div className="space-y-1.5">
                      {Object.entries(result.type_distribution as Record<string, number>)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium w-24 text-center ${TYPE_COLORS[type] || TYPE_COLORS.context}`}>
                              {type.replace('_', ' ')}
                            </span>
                            <div className="flex-1 h-2 bg-white/[0.03] rounded-full overflow-hidden">
                              <div className="h-full bg-purple-500/50 rounded-full"
                                style={{ width: `${(count / Math.max(result.total_units, 1)) * 100}%` }} />
                            </div>
                            <span className="text-[10px] text-gray-500 w-10 text-right tabular-nums">{count}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <input value={reviewTopic} onChange={e => setReviewTopic(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doReview()}
                placeholder="Enter topic to review..."
                className="flex-1 text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50" />
              <select value={reviewLimit} onChange={e => setReviewLimit(parseInt(e.target.value, 10))}
                className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-gray-300">
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <button onClick={doReview} disabled={loading || !reviewTopic.trim()}
                className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50">
                {loading ? 'Reviewing...' : 'Review'}
              </button>
            </div>
            {result?.by_type && (
              <div className="space-y-3">
                <div className="text-xs text-gray-400">{result.total_matches} matches for &ldquo;{result.topic}&rdquo;</div>
                {Object.entries(result.by_type as Record<string, any[]>).map(([type, items]) => (
                  <details key={type} open className="bg-white/[0.02] border border-white/[0.06] rounded-lg">
                    <summary className="px-4 py-2 text-xs text-gray-300 cursor-pointer hover:bg-white/[0.02]">
                      <span className={`inline-block px-1.5 py-0.5 rounded font-medium mr-2 ${TYPE_COLORS[type] || TYPE_COLORS.context}`}>
                        {type.replace('_', ' ')}
                      </span>
                      ({items.length})
                    </summary>
                    <div className="px-4 pb-3 space-y-2">
                      {items.map((item: any, i: number) => (
                        <div key={i} className="text-[11px] text-gray-400 border-l-2 border-white/5 pl-3 py-1">
                          <div>{item.text}</div>
                          <div className="text-[10px] text-gray-600 mt-0.5">
                            confidence: {item.confidence?.toFixed(2)} · similarity: {item.similarity?.toFixed(3)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'refine' && (
          <div className="space-y-4">
            {!result && (
              <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400">
                Refine requires an LLM API key for distillation. If not configured, go to{' '}
                <button onClick={() => { /* parent would need to expose setTab — or use a link */ }}
                  className="underline">Settings</button> to add one.
              </div>
            )}
            <div>
              <label className="text-xs text-gray-400 block mb-1">Domain Context</label>
              <textarea value={domainContext} onChange={e => setDomainContext(e.target.value)}
                placeholder="Describe the domain this lobe should focus on..."
                rows={3}
                className="w-full text-sm bg-white/5 border border-white/10 rounded-lg p-3 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 resize-y" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-2">Distillation passes</label>
              <div className="flex gap-3">
                {['decisions', 'patterns', 'preferences', 'error_fixes'].map(t => (
                  <label key={t} className="flex items-center gap-1.5 text-xs text-gray-400">
                    <input type="checkbox" checked={refineTypes.includes(t)}
                      onChange={e => setRefineTypes(prev =>
                        e.target.checked ? [...prev, t] : prev.filter(x => x !== t)
                      )}
                      className="accent-purple-500" />
                    {t.replace('_', ' ')}
                  </label>
                ))}
              </div>
            </div>
            <button onClick={doRefine} disabled={loading}
              className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50">
              {loading ? <><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> Refining...</> : 'Refine Lobe'}
            </button>
            {result && (
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 text-xs text-gray-300 space-y-1">
                <div>Source units found: {result.source_units_found}</div>
                <div>Old distilled purged: {result.distilled_purged}</div>
                <div>New units created: <span className="text-green-400">{result.new_units_created}</span></div>
                {result.errors?.length > 0 && (
                  <div className="text-red-400 mt-1">{result.errors.join(', ')}</div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'publish' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Name *</label>
                <input value={pubName} onChange={e => setPubName(e.target.value)}
                  placeholder="My Knowledge Pack"
                  className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-gray-300 placeholder-gray-600" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Author *</label>
                <input value={pubAuthor} onChange={e => setPubAuthor(e.target.value)}
                  placeholder="Your name"
                  className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-gray-300 placeholder-gray-600" />
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Description</label>
              <textarea value={pubDesc} onChange={e => setPubDesc(e.target.value)}
                placeholder="What this knowledge pack contains..."
                rows={2}
                className="w-full text-xs bg-white/5 border border-white/10 rounded p-2 text-gray-300 placeholder-gray-600 resize-y" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Tags (comma-separated)</label>
                <input value={pubTags} onChange={e => setPubTags(e.target.value)}
                  placeholder="engineering, patterns"
                  className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-gray-300 placeholder-gray-600" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Version</label>
                <input value={pubVersion} onChange={e => setPubVersion(e.target.value)}
                  className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-gray-300" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">License</label>
                <select value={pubLicense} onChange={e => setPubLicense(e.target.value)}
                  className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-gray-300">
                  <option value="cc-by">CC-BY</option>
                  <option value="cc-by-sa">CC-BY-SA</option>
                  <option value="commercial">Commercial</option>
                  <option value="free">Free</option>
                </select>
              </div>
            </div>
            <button onClick={doPublish} disabled={loading || !pubName || !pubAuthor}
              className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50">
              {loading ? <><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> Publishing...</> : 'Publish to Marketplace'}
            </button>
            {result && (
              <div className="space-y-2">
                {result.quality_warning && (
                  <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400">
                    Coverage score is low ({result.quality?.coverage_score?.toFixed(2)}). Consider seeding more documents or refining.
                  </div>
                )}
                <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 text-xs text-gray-300 space-y-1">
                  <div>Output: <span className="text-gray-400 font-mono">{result.path}</span></div>
                  <div>Units: {result.total_before} total, {result.excluded_sensitivity} excluded (sensitivity), {result.pii_scrubbed} PII-scrubbed</div>
                  <div>Final pack: <span className="text-green-400">{result.final_units} units</span></div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds (component not yet imported by page)

- [ ] **Step 3: Commit**

```bash
git add src/components/cortex/curation-tab.tsx
git commit -m "feat(cortex): add curation tab component with pipeline UI"
```

---

### Task 10: Build Marketplace Tab Components

**Files:**
- Create: `src/components/cortex/marketplace-card.tsx`
- Create: `src/components/cortex/import-dialog.tsx`
- Create: `src/components/cortex/marketplace-tab.tsx`

- [ ] **Step 1: Create marketplace card**

```typescript
// src/components/cortex/marketplace-card.tsx
'use client';

import { useState } from 'react';
import { Package, ChevronDown, ChevronUp } from 'lucide-react';
import { TYPE_COLORS } from './constants';

interface PackManifest {
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
}

interface Props {
  filename: string;
  manifest: PackManifest;
  onImport: (filename: string, manifest: PackManifest) => void;
}

export function MarketplaceCard({ filename, manifest, onImport }: Props) {
  const [showPreview, setShowPreview] = useState(false);
  const mp = manifest.marketplace;

  const coverageColor = mp
    ? mp.quality.coverage_score > 0.7 ? 'text-green-400'
      : mp.quality.coverage_score > 0.3 ? 'text-amber-400'
      : 'text-red-400'
    : 'text-gray-500';

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4 hover:border-white/10 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-purple-400 shrink-0" />
            <h3 className="text-sm font-medium text-gray-200 truncate">
              {mp?.name || filename}
            </h3>
            {mp && <span className="text-[10px] text-gray-600 shrink-0">v{mp.packageVersion}</span>}
          </div>
          {mp && <div className="text-[10px] text-gray-500 mt-0.5">by {mp.author}</div>}
          <p className="text-xs text-gray-400 mt-1 line-clamp-2">
            {mp?.description || `Exported ${new Date(manifest.exportDate).toLocaleDateString()}`}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-lg font-semibold tabular-nums ${coverageColor}`}>
            {mp ? mp.quality.coverage_score.toFixed(2) : '—'}
          </div>
          <div className="text-[10px] text-gray-600">{manifest.unitCount} units</div>
        </div>
      </div>

      {mp?.tags && mp.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {mp.tags.map(tag => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-white/5 border border-white/[0.06] rounded text-gray-500">
              {tag}
            </span>
          ))}
          {mp.license && (
            <span className="text-[9px] px-1.5 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded text-purple-400">
              {mp.license}
            </span>
          )}
        </div>
      )}

      {mp?.preview && mp.preview.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-400">
            Preview {showPreview ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showPreview && (
            <div className="mt-1 space-y-1">
              {mp.preview.map((p, i) => (
                <div key={i} className="text-[10px] text-gray-500 border-l-2 border-white/5 pl-2 py-0.5">
                  <span className={`inline-block px-1 py-0 rounded mr-1 ${TYPE_COLORS[p.type] || TYPE_COLORS.context}`}>
                    {p.type}
                  </span>
                  {p.text.slice(0, 100)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button onClick={() => onImport(filename, manifest)}
        className="mt-3 w-full py-1.5 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded-lg">
        Import
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create import dialog**

```typescript
// src/components/cortex/import-dialog.tsx
'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

interface Props {
  filename: string;
  hasDomainContext: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function ImportDialog({ filename, hasDomainContext, onClose, onComplete }: Props) {
  const [targetLayer, setTargetLayer] = useState('workspace');
  const [workspaceId, setWorkspaceId] = useState('');
  const [mergeStrategy, setMergeStrategy] = useState('merge');
  const [reEmbed, setReEmbed] = useState(false);
  const [applyDomainCtx, setApplyDomainCtx] = useState(false);
  const [workspaces, setWorkspaces] = useState<{ id: number; name: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(api('/api/workspaces'))
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data : data.local || [];
        setWorkspaces(list);
        if (list.length > 0) setWorkspaceId(String(list[0].id));
      })
      .catch(() => {});
  }, []);

  const handleImport = async () => {
    setImporting(true);
    setError(null);
    try {
      // Fetch the file from marketplace dir and upload it
      const formData = new FormData();
      const res = await fetch(api(`/api/cortex/marketplace/preview?file=${encodeURIComponent(filename)}`));
      // We need to send the file — fetch it as blob from the server
      // Actually, the import route expects a file upload. We'll pass the filename to a modified import.
      // For now, use a server-side import that reads from marketplace dir directly.
      const importRes = await fetch(api('/api/cortex/import'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketplace_file: filename,
          target_layer: targetLayer,
          workspace_id: targetLayer === 'workspace' ? workspaceId : undefined,
          merge_strategy: mergeStrategy,
          re_embed: reEmbed,
        }),
      });
      if (!importRes.ok) {
        const data = await importRes.json();
        throw new Error(data.error || 'Import failed');
      }
      onComplete();
    } catch (e: any) {
      setError(e.message);
    }
    setImporting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-200">Import {filename}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Target layer</label>
            <div className="flex gap-2">
              {['personal', 'workspace', 'team'].map(l => (
                <button key={l} onClick={() => setTargetLayer(l)}
                  className={`px-3 py-1 text-xs rounded ${
                    targetLayer === l ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-white/5 text-gray-500 border border-white/[0.06]'
                  }`}>{l}</button>
              ))}
            </div>
          </div>

          {targetLayer === 'workspace' && (
            <div>
              <label className="text-[10px] text-gray-500 block mb-1">Workspace</label>
              <select value={workspaceId} onChange={e => setWorkspaceId(e.target.value)}
                className="w-full text-xs bg-white/5 border border-white/10 rounded px-2 py-1.5 text-gray-300">
                {workspaces.map(ws => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Merge strategy</label>
            <div className="flex gap-2">
              {['append', 'merge', 'replace'].map(s => (
                <button key={s} onClick={() => setMergeStrategy(s)}
                  className={`px-3 py-1 text-xs rounded ${
                    mergeStrategy === s ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-white/5 text-gray-500 border border-white/[0.06]'
                  }`}>{s}</button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" checked={reEmbed} onChange={e => setReEmbed(e.target.checked)} className="accent-purple-500" />
            Re-generate embeddings (slower, matches your provider)
          </label>

          {hasDomainContext && (
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={applyDomainCtx} onChange={e => setApplyDomainCtx(e.target.checked)} className="accent-purple-500" />
              Apply pack&apos;s domain context to target workspace
            </label>
          )}

          {error && <div className="text-xs text-red-400">{error}</div>}

          <button onClick={handleImport} disabled={importing}
            className="w-full py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50">
            {importing ? <><Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> Importing...</> : 'Start Import'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create marketplace tab**

```typescript
// src/components/cortex/marketplace-tab.tsx
'use client';

import { useState, useEffect } from 'react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { MarketplaceCard } from './marketplace-card';
import { ImportDialog } from './import-dialog';

export function MarketplaceTab() {
  const [packs, setPacks] = useState<any[]>([]);
  const [directory, setDirectory] = useState('');
  const [loading, setLoading] = useState(true);
  const [importTarget, setImportTarget] = useState<{ filename: string; manifest: any } | null>(null);

  const fetchPacks = async () => {
    setLoading(true);
    try {
      const res = await fetch(api('/api/cortex/marketplace/browse'));
      if (res.ok) {
        const data = await res.json();
        setPacks(data.packs || []);
        setDirectory(data.directory || '');
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchPacks(); }, []);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-sm font-medium text-gray-200">Marketplace</h2>
          {directory && <div className="text-[10px] text-gray-600 font-mono mt-0.5">{directory}</div>}
        </div>
        <button onClick={fetchPacks} disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white/5 border border-white/[0.06] rounded-lg text-gray-400 hover:text-gray-300 disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500 text-center py-12">Scanning marketplace...</p>}

      {!loading && packs.length === 0 && (
        <div className="text-center py-16">
          <FolderOpen className="w-8 h-8 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No .cortexpack files found</p>
          <p className="text-[10px] text-gray-600 mt-1">
            Publish a lobe from the Curation tab, or drop .cortexpack files into the marketplace directory.
          </p>
        </div>
      )}

      {!loading && packs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {packs.map(pack => (
            <MarketplaceCard
              key={pack.filename}
              filename={pack.filename}
              manifest={pack.manifest}
              onImport={(f, m) => setImportTarget({ filename: f, manifest: m })}
            />
          ))}
        </div>
      )}

      {importTarget && (
        <ImportDialog
          filename={importTarget.filename}
          hasDomainContext={!!importTarget.manifest.marketplace?.domain_context}
          onClose={() => setImportTarget(null)}
          onComplete={() => { setImportTarget(null); fetchPacks(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/components/cortex/marketplace-card.tsx src/components/cortex/import-dialog.tsx src/components/cortex/marketplace-tab.tsx
git commit -m "feat(cortex): add marketplace tab with card grid and import dialog"
```

---

### Task 11: Wire Up 6-Tab Cortex Page

**Files:**
- Modify: `src/app/(desktop)/cortex/page.tsx`
- Delete: `src/components/cortex/context-tab.tsx` (deferred from Task 6)

- [ ] **Step 1: Delete context-tab.tsx**

```bash
rm src/components/cortex/context-tab.tsx
```

- [ ] **Step 2: Update the page to use 6 tabs**

Replace the entire file:

```typescript
'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { KnowledgeTab } from '@/components/cortex/knowledge-tab';
import { CortexSettings } from '@/components/cortex/cortex-settings';
import { CortexDashboard } from '@/components/cortex/cortex-dashboard';
import { CurationTab } from '@/components/cortex/curation-tab';
import { MarketplaceTab } from '@/components/cortex/marketplace-tab';

const EntityGraphView = dynamic(
  () => import('@/components/cortex/entity-graph').then(m => ({ default: m.EntityGraphView })),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading graph...</div> }
);

type Tab = 'dashboard' | 'graph' | 'knowledge' | 'curation' | 'marketplace' | 'settings';

export default function CortexPage() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    fetch(api('/api/cortex/status'))
      .then(r => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'graph', label: 'Graph' },
    { key: 'knowledge', label: 'Knowledge' },
    { key: 'curation', label: 'Curation' },
    { key: 'marketplace', label: 'Marketplace' },
    { key: 'settings', label: 'Settings' },
  ];

  const totalKnowledge = stats
    ? Object.values(stats.layers || {}).reduce((sum: number, l: any) => sum + (l.count || 0), 0)
    : 0;

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      <div className="flex items-center border-b border-white/5 px-4 shrink-0">
        <div className="flex">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? 'text-purple-400 border-purple-400'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto text-xs text-gray-600">
          {totalKnowledge} knowledge units
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'dashboard' && <CortexDashboard />}
        {tab === 'graph' && <EntityGraphView />}
        {tab === 'knowledge' && <KnowledgeTab />}
        {tab === 'curation' && <CurationTab />}
        {tab === 'marketplace' && <MarketplaceTab />}
        {tab === 'settings' && (
          <div className="p-6 max-w-2xl space-y-8">
            <CortexSettings />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -5`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git rm src/components/cortex/context-tab.tsx
git add src/app/(desktop)/cortex/page.tsx
git commit -m "feat(cortex): wire 6-tab layout, remove context tab"
```

---

### Task 12: Final Build Verification

- [ ] **Step 1: Full build**

Run: `npx next build 2>&1 | tail -20`
Expected: Build succeeds, all routes compiled

- [ ] **Step 2: Verify all new routes are compiled**

Look for these in the build output:
- `/api/cortex/curation/seed`
- `/api/cortex/curation/assess`
- `/api/cortex/curation/review`
- `/api/cortex/curation/refine`
- `/api/cortex/curation/publish`
- `/api/cortex/marketplace/browse`
- `/api/cortex/marketplace/preview`

- [ ] **Step 3: Commit any build fixes if needed**

```bash
git add -A
git commit -m "fix(cortex): resolve build issues from UI integration"
```
