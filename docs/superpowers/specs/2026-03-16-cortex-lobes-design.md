# Cortex Lobes: Knowledge Compartments and Sharing

**Date:** 2026-03-16
**Status:** Design approved, pending implementation plan
**Scope:** Add knowledge compartmentalization ("lobes") to Cortex with workspace-level access control, privacy, exclusions, and cross-user sharing

## Overview

Every workspace in Spaces has a **lobe** — its compartment of learned knowledge within Cortex. By default, your workspaces can pull knowledge from each other's lobes. Workspaces can be marked private, excluded from specific other workspaces, or shared with other users. Other users' lobes are closed by default and require explicit sharing + acceptance.

### Terminology

- **Lobe** — a compartment of knowledge associated with a workspace, team, department, or organization. Named after the lobes of the cerebral cortex. Each lobe specializes in the knowledge accumulated from its context.
- **Subscription** — when a workspace pulls knowledge from a lobe
- **Sharing** — when a user makes their lobe available to other users

## Access Rules

### Same User (default behavior)

| Scenario | Access |
|----------|--------|
| Workspace A queries Workspace B's lobe | **Allowed** (default) |
| Workspace A queries a private workspace's lobe | **Denied** |
| Workspace A has Workspace B excluded | **Denied** |
| Workspace A queries personal lobe | **Allowed** (always) |
| Workspace A queries team/dept/org lobes | **Allowed** (via entity graph inheritance) |

**Default:** All your workspaces can see all your other workspaces' lobes. Open by default, restrict when needed.

### Cross-User

| Scenario | Access |
|----------|--------|
| User A queries User B's lobe | **Denied** (default) |
| User B shares a lobe with User A, User A accepts | **Allowed** |
| User B revokes sharing | **Denied** again |
| Team lobe (shared by team membership) | **Allowed** for team members |
| Org lobe (trickled-down decisions) | **Allowed** for org members |

**Default:** Other users' workspace lobes are invisible. Team/dept/org lobes are accessible through the entity graph hierarchy (already implemented in the Boundary Engine).

## Data Model

### Workspace Lobe Configuration

Each workspace gets a lobe configuration stored as JSON in the workspaces table:

```typescript
interface LobeConfig {
  // Privacy
  isPrivate: boolean;          // If true, no other workspace can pull from this lobe

  // Exclusions — workspaces that CANNOT pull from this lobe
  excludedFrom: number[];      // workspace IDs that are blocked

  // Inclusions — additional lobes this workspace subscribes to
  subscriptions: LobeSubscription[];

  // Tags on this workspace's lobe (for tag-based subscription)
  tags: string[];
}

interface LobeSubscription {
  type: 'workspace' | 'user' | 'tag' | 'team' | 'department' | 'organization';
  id: string;        // workspace ID, user entity ID, tag name, etc.
  label: string;     // display name
  accepted: boolean; // for cross-user: has the subscriber accepted?
}
```

### Cross-User Sharing

Sharing is a two-step handshake:

1. **Owner shares:** User B marks their lobe as shared with User A (creates a share record)
2. **Recipient accepts:** User A sees the shared lobe offer and accepts it (adds subscription)

```typescript
interface LobeShare {
  id: string;
  ownerUserId: string;          // who is sharing
  ownerWorkspaceId: number;     // which workspace's lobe
  ownerLobeName: string;        // display name
  sharedWithUserId: string;     // who it's shared with
  accepted: boolean;            // has recipient accepted?
  created: string;
}
```

Storage: `lobe_shares` table in the entity graph SQLite database.

### Defaults

New workspace lobe config:
```json
{
  "isPrivate": false,
  "excludedFrom": [],
  "subscriptions": [],
  "tags": []
}
```

This means: open to all your workspaces, no exclusions, no extra subscriptions, no tags. The workspace automatically inherits from personal + team + dept + org lobes through the entity graph.

## How It Integrates with Context Assembly

### Current Flow (Pillar 3)

The Context Assembly Engine's `computeSourceWeights()` currently searches three hardcoded layers: personal, workspace, team.

### New Flow

Replace the hardcoded layer list with a dynamic scope list built from the workspace's lobe configuration:

```
1. Start with workspace's own lobe (always included)
2. Add personal lobe (always included)
3. Add inherited lobes from entity graph (team → dept → org)
4. Add explicit subscriptions from LobeConfig
5. Remove any that are private or excluded
6. Remove any cross-user lobes that aren't shared+accepted
7. Pass remaining scopes to the Context Assembly Engine
```

The weight computation stays the same — graph proximity determines weight. Subscribed lobes that aren't in the natural graph path get a base weight of 0.4 (lower than inherited but still present).

### Storage Mapping

Each workspace's lobe corresponds to a LanceDB storage path:
- Workspace 42's lobe → `workspace/42` (already exists)
- Personal lobe → `personal` (already exists)
- Team lobe → `team` (already exists)

No new storage structures needed. Lobes are a **view layer** on top of existing knowledge storage, controlling which storage paths are searched.

## API Changes

### New Endpoints

```
GET    /api/cortex/lobes                     — list all accessible lobes for current user
GET    /api/cortex/lobes/:workspaceId        — get lobe config for a workspace
PUT    /api/cortex/lobes/:workspaceId        — update lobe config (privacy, exclusions, tags)
POST   /api/cortex/lobes/:workspaceId/subscribe — add a subscription
DELETE /api/cortex/lobes/:workspaceId/subscribe/:id — remove a subscription
POST   /api/cortex/lobes/share               — share a lobe with another user
POST   /api/cortex/lobes/share/:id/accept    — accept a shared lobe
DELETE /api/cortex/lobes/share/:id            — revoke or decline a share
GET    /api/cortex/lobes/shares              — list incoming/outgoing shares
```

### Modified Endpoints

```
GET /api/cortex/context — now accepts optional workspace_id to resolve lobe config
```

## UI

### Workspace Settings → "Knowledge Lobes" Section

Simple settings panel within existing workspace settings:

**Status line:** "This workspace draws from 4 lobes" (count of active sources)

**Privacy toggle:** "Private lobe — other workspaces can't access this knowledge"

**Tags input:** chip-style tag input for labeling this workspace's lobe

**Active sources list:** shows all lobes this workspace pulls from:
- Own workspace (always, can't remove)
- Personal (always, can't remove)
- Team: Platform (inherited, can mute)
- Org: Acme Corp (inherited, can mute)
- Workspace: Auth Service (subscribed, can remove)
- Tag: infrastructure (subscribed, can remove)
- Shared: Bob's Security workspace (cross-user, can remove)

**"Add source" button:** dropdown/search to subscribe to:
- Another workspace (by name)
- A tag
- A team/department
- A shared lobe from another user

**Exclusions section** (collapsed by default): "Exclude specific workspaces from accessing this lobe" — multi-select of workspace names.

### Shared Lobes Section (in main Cortex page or settings)

**Incoming shares:** "Bob shared 'Security Workspace' with you" — Accept / Decline buttons
**Outgoing shares:** "You shared 'Platform' with Alice" — Revoke button

## Implementation Notes

### Where Lobe Config Lives

Option A: JSON column on workspaces table (`lobe_config TEXT DEFAULT '{}'`)
Option B: Separate `workspace_lobe_config` table

**Recommendation: Option A** — it's simpler, the config is small, and it's always loaded with the workspace. Add a migration to add the column.

### Integration with Boundary Engine

The lobe system sits ABOVE the boundary engine. Lobes determine which scopes are searched. The boundary engine then filters individual results by sensitivity/policy/creator-override within those scopes. They compose naturally:

```
Lobe Config → determines searchable scopes
    ↓
Context Assembly Engine → searches those scopes
    ↓
Boundary Engine → filters results by access control
    ↓
User sees results
```

### Cross-User Sharing Security

When User A searches a lobe shared by User B:
- The search runs against User B's workspace storage
- The Boundary Engine still applies — confidential/restricted knowledge is filtered
- The sensitivity auto-classifier already marks sensitive content appropriately
- Audit trail logs cross-user access for compliance

### Consulting Firm Scenario

Setup for a consulting firm with clients Initech and Globex:

1. Create workspaces: "Initech Project", "Globex Project", "Internal"
2. Mark "Initech Project" with tag `initech`, mark private
3. Mark "Globex Project" with tag `globex`, mark private
4. "Internal" workspace: default (pulls from everything non-private)
5. "Initech Project": remove "Globex Project" from accessible lobes (it's already excluded by privacy, belt + suspenders)
6. Result: Initech workspace sees only its own knowledge + personal + team + org. Never sees Globex. Globex never sees Initech. Internal sees both (org-level patterns only, not private workspace knowledge).

## File Structure

```
New files:
├── src/lib/cortex/lobes/config.ts        — LobeConfig types and defaults
├── src/lib/cortex/lobes/resolver.ts      — Resolve accessible lobes for a workspace
├── src/lib/cortex/lobes/shares.ts        — Cross-user sharing logic
├── src/lib/cortex/lobes/index.ts         — Barrel export
├── src/app/api/cortex/lobes/route.ts     — List/get lobes
├── src/app/api/cortex/lobes/[id]/route.ts — Update lobe config
├── src/app/api/cortex/lobes/share/route.ts — Share management
├── src/components/cortex/lobe-settings.tsx — UI component

Modified files:
├── src/lib/cortex/retrieval/context-engine.ts — Use lobe resolver for search scopes
├── src/lib/db/queries.ts                      — Add lobe_config column to workspaces
├── src/app/(desktop)/cortex/page.tsx          — Add Lobes tab or integrate into Settings
```

## Success Criteria

- New workspaces see knowledge from all non-private sibling workspaces by default
- Marking a workspace private immediately hides its knowledge from other workspaces
- Excluding a workspace prevents bidirectional knowledge access
- Cross-user sharing requires explicit share + accept handshake
- Consulting scenario works: private client workspaces with no cross-contamination
- Context Assembly Engine respects lobe config within <150ms (no performance regression)
- All access decisions logged in audit trail
