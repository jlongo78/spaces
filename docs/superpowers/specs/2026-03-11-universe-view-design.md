# Universe View — 3D Workspace Navigator

**Date:** 2026-03-11
**Status:** Approved

## Summary

A 3D "universe" view for the workspace chooser that renders workspaces as glowing orbs floating in space, clustered by node. Built with React Three Fiber (R3F), lazy-loaded, and available as a third view mode alongside the existing grid and list views.

The visual direction is "refined nebula" — bold orb presence with glass-like materials and subtle glow halos, but restrained aesthetics (low opacities, sparse starfield, muted labels). Cinematic without being a screensaver.

## Goals

- **Scale visualization** — See the entire constellation of local + remote workspaces at a glance, zoom from galaxy view down to a single workspace
- **Immersive navigation** — Flying between workspace clusters feels cinematic and alive
- **Graceful scaling** — Works with 3 workspaces or 100+ across many nodes
- **Zero cost when unused** — Lazy-loaded; users who prefer grid/list pay nothing

## Non-Goals

- Replacing the flat views (grid/list remain the default)
- Real-time collaboration visualization (future enhancement)
- VR/AR support
- Custom workspace positioning (orbs auto-arrange)
- Templates in the 3D scene (templates remain in the HTML overlay or accessible via grid/list; they're a creation tool, not a spatial object)

## Architecture

### View Mode Integration

The existing `WorkspaceChooser` component gains a third view mode:

```
WorkspaceChooser
├── viewMode === 'grid'     → grid cards (existing)
├── viewMode === 'list'     → list rows (existing)
└── viewMode === 'universe' → <UniverseView /> (new, lazy-loaded)
```

The view toggle in the top bar adds a third button (globe/orbit icon). The `UniverseView` receives the same props as the flat views — no new API endpoints or schema changes.

### File Structure

```
src/components/workspace/
├── workspace-chooser.tsx       # Existing — add 'universe' to ViewMode, add toggle
├── universe-view.tsx           # New — R3F canvas, scene, camera, post-processing, overlay
├── universe-orb.tsx            # New — single workspace orb mesh + interactions
└── universe-cluster.tsx        # New — groups orbs by node, handles positioning
```

### Dependencies

```
@react-three/fiber          # React renderer for Three.js
@react-three/drei           # OrbitControls, Text, utilities
@react-three/postprocessing # UnrealBloomPass for glow
three                       # Peer dependency
```

All lazy-loaded via `next/dynamic` with `ssr: false`.

## Scene Composition

```
<Canvas>
  <PostProcessing>              UnrealBloomPass (threshold ~0.8, subtle)
  <ambientLight />              Very dim ambient
  <Starfield />                 ~200 point sprites, static, subtle twinkle

  <Cluster                      Local workspaces
    position={[0, 0, 0]}        Center of scene
    label="Local"
    color="#6366f1">
    {filteredLocal.map(ws => <Orb ws={ws} />)}
  </Cluster>

  <Cluster                      Per remote node
    position={[computed]}        Arranged in circle around center
    label={node.nodeName}
    color="#10b981">
    {node.workspaces.map(ws => <Orb ws={ws} remote />)}
  </Cluster>

  <OrbitControls />             Drag to orbit, scroll to zoom
  <CameraRig />                 Animated fly-to on workspace click
</Canvas>

<HtmlOverlay>                   Regular React, absolute over canvas
  ├── ViewToggle                Grid / List / Universe
  ├── SearchBar                 Filters orbs by name
  ├── HoverTooltip              Name, pane count, agents, status
  ├── ControlHints              "scroll to zoom · drag to orbit · click to enter"
  └── NewSpaceButton            "+ New Space"
</HtmlOverlay>
```

## Spatial Layout

### Cluster Positioning

- **Local cluster** sits at the scene origin `[0, 0, 0]`
- **Remote node clusters** are arranged in a circle around the origin at radius ~15 units, evenly spaced by angle
- Single remote node → placed to the right
- Multiple nodes → evenly distributed around the circle
- Scales naturally: 10 nodes = tighter angular spacing

### Orb Positioning Within Clusters

- Orbs arranged in a loose sphere around the cluster center
- Largest workspace (most panes) at the center, smaller ones orbit outward
- Small random offset (seeded by workspace ID) for organic feel
- Positions computed deterministically from workspace IDs — stable across renders

### Orb Sizing

Radius scales with pane count: `0.3 + ((paneCount ?? 0) * 0.15)`, clamped to `[0.3, 1.2]`. When `paneCount` is undefined, defaults to 0 (minimum radius 0.3).

The primary workspace dominates visually; single-pane workspaces are small satellites.

## Orb Material & Visuals

### Material

Start with `MeshPhysicalMaterial` with `transmission` (drei's glass material) for simplicity. If the look needs more control, upgrade to a custom `ShaderMaterial`. Either way, the orb should achieve:
- **Glass inner gradient** — radial tint using workspace `color` (parsed via `new THREE.Color(ws.color)`, which handles hex, named colors, and rgb/hsl strings)
- **Transparency** — `opacity: ~0.7`
- **Rim lighting** — bright edge glow, like a planet catching light from behind
- **Float animation** — each orb bobs gently on a sine wave with unique phase offset. Disabled when `prefers-reduced-motion` is active.

### Visual Hierarchy

- **Active workspace** — small bright dot indicator beside orb
- **Remote workspaces** — slightly more transparent, emerald-tinted glow
- **Cluster halos** — very subtle radial gradient behind each group
- **Connection lines** — thin, low-opacity lines between orbs in a cluster
- **Cluster labels** — uppercase, wide letter-spacing, very low opacity

### Starfield

~200 particles rendered as a single `THREE.Points` object (one draw call). Random positions in a large bounding sphere. Static positions, subtle opacity oscillation (twinkle). Not dense — quality over quantity.

### Post-Processing

UnrealBloomPass with:
- `threshold: 0.8` — only the brightest parts bloom
- `strength: 0.3` — subtle, not overwhelming
- `radius: 0.5` — soft spread

## Interactions

### Camera

- **Orbit** — click-drag rotates the camera around the scene (drei OrbitControls)
- **Zoom** — mouse wheel zooms in/out. Clamped to prevent going inside orbs or too far out
- **Auto-focus** — on mount, camera gently eases to show local cluster

### Hover

- Raycaster detects hover on orbs
- Hovered orb scales to 1.15x with spring animation
- HTML tooltip appears near cursor: workspace name, pane count, agent types, active status

### Click → Fly-in → Enter

1. Click an orb
2. Camera animates (ease-in-out, ~800ms) flying toward the orb
3. Canvas fades to black over the last 200ms
4. `onSwitchWorkspace(ws.id)` is called — workspace enters normally
5. For remote workspaces: `onOpenRemote(nodeId, wsId)` instead

### Search Integration

- Search bar floats over the canvas (HTML overlay)
- As user types, non-matching orbs fade to 10% opacity
- Matching orbs pulse briefly to draw attention
- Reuses the same `matchesSearch` logic from the flat view
- Source filter (all/local/network) also works — hides entire clusters

### Touch & Trackpad

- OrbitControls natively supports touch (pinch-to-zoom, two-finger orbit)
- On touch devices, hover tooltips are replaced by tap-and-hold (shows tooltip) vs tap (enters workspace)
- Trackpad pinch-to-zoom works via the scroll wheel handler

### Return to Universe

When the user closes a workspace and returns to the chooser, the universe view remounts from scratch. Camera position is not preserved — it always starts with the gentle auto-focus on the local cluster. This keeps the experience simple and consistent.

## Error Handling & Fallbacks

### WebGL Failure

If the R3F canvas fails to initialize (no WebGL support, software renderer, GPU blocklist):
- Catch the error via React error boundary wrapping the canvas
- Automatically fall back to grid view
- Show a brief toast: "3D view unavailable — using grid view"

### Dynamic Import Failure

If the lazy import of the universe module fails (network error, chunk load failure):
- The `loading` fallback shows a spinner
- On error, the dynamic import rejects and the error boundary catches it
- Falls back to grid view with a toast

### Loading State

While the ~180KB+ bundle loads, show a centered spinner with "Loading universe..." text on a dark background (matching the scene's `#07070f`). The spinner uses the existing `Loader2` component.

### Data Loading

The universe view receives `wsLoading` and `remoteLoading` props. While loading:
- Show the starfield and empty scene (sets the mood)
- Display a subtle "Discovering spaces..." label
- Orbs animate in once data arrives (fade + scale from 0)

### Remote Node Errors

`remoteErrors` are shown as dim red indicators at the position where the node's cluster would be — a small `X` icon with the node name, matching the error display in the flat views.

## Accessibility

### Keyboard Navigation

- `Tab` cycles focus between orbs (order: local cluster first, then remote clusters)
- `Enter` on a focused orb triggers the fly-in → enter sequence
- `Escape` returns focus to the search bar
- Arrow keys nudge the camera orbit slightly

### Screen Readers

- The `<canvas>` element gets `role="img"` with an `aria-label` summarizing the scene (e.g., "Workspace universe: 5 local spaces, 3 spaces on staging-box")
- A visually hidden list of workspace names is rendered alongside the canvas for screen reader users
- The HTML overlay (search, tooltips, buttons) is fully accessible natively

### Reduced Motion

- When `prefers-reduced-motion: reduce` is active:
  - Orb float animation is disabled (static positions)
  - Fly-in camera animation is replaced with an instant cut
  - Starfield twinkle is disabled
  - Hover scale is instant (no spring)

## Performance

### Lazy Loading

```typescript
const UniverseView = dynamic(
  () => import('@/components/workspace/universe-view'),
  { ssr: false, loading: () => <Loader /> }
);
```

Users who never click "Universe" download zero bytes of Three.js.

### Animation Loop

- `requestAnimationFrame` only runs while universe view is visible
- When switching to grid/list, the canvas unmounts — no background GPU work
- Bloom pass is the most expensive operation; kept subtle to minimize cost

### Scale Target

- 60fps with up to ~100 orbs (typical usage: 5-30)
- At this scale, individual meshes are fine
- Future: InstancedMesh if 500+ workspaces ever needed

### Bundle Impact

Estimated ~250-300KB gzipped total (`three` alone is ~150KB, plus R3F + drei + postprocessing). All loaded on demand — zero impact on initial page load.

## UI Overlay

Floating HTML elements positioned absolute over the canvas. Same dark glass aesthetic as the mockup.

- **Top-left:** View toggle (Grid / List / Universe) — frosted glass pill
- **Top-right:** Search bar — same as flat view but with glass background
- **Bottom-left:** Control hints — "scroll to zoom · drag to orbit · click to enter"
- **Bottom-right:** "+ New Space" button
- **Cursor-follow:** Hover tooltip (appears near mouse on orb hover)

## Integration with Existing Code

### workspace-chooser.tsx Changes

1. Add `'universe'` to the `ViewMode` type
2. Add a third toggle button (globe/orbit icon) to the view switcher
3. When `viewMode === 'universe'`, the component renders the canvas full-viewport (replacing the scrollable `max-w-4xl` container). The top bar with view toggle remains; all other UI moves to the HTML overlay inside `UniverseView`.
4. Wrap the lazy-loaded `UniverseView` in a React error boundary that falls back to grid view

### UniverseView Props

`UniverseView` receives a subset of `WorkspaceChooserProps`:

```typescript
interface UniverseViewProps {
  workspaces: Workspace[];
  wsLoading: boolean;
  hasNetwork: boolean;
  remoteNodes: RemoteNode[];
  remoteErrors: RemoteError[];
  remoteLoading: boolean;
  templates: Template[];
  onSwitchWorkspace: (wsId: number) => void;
  onCreateWorkspace: () => void;
  onSelectTemplate: (template: Template) => void;
  onOpenRemote: (nodeId: string, wsId: number) => void;
}
```

`basePath` and `onGoHome` are handled by the parent `WorkspaceChooser` (top bar stays outside the canvas).

### No Backend Changes

The universe view is purely a rendering layer. All data is already available via existing props.

## Branch

All work on branch `feature/universe-view`, off `main`.
