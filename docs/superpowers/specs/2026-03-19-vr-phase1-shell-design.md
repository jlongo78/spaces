# Spaces VR — Phase 1: VR Shell + Static Rooms

> Phase 1 of 5. Builds the spatial environment on Quest 3 using Unity + Meta XR SDK. Fetches workspace data from the Spaces server to populate the lobby. No live terminal data yet — that's Phase 2+3.

---

## Decisions

- **Platform**: Meta Quest 3, native Unity app (not WebXR)
- **Engine**: Unity 2022 LTS + Meta XR SDK (v68+) + Meta Interaction SDK
- **Interaction**: Eye tracking (gaze focus) + hand tracking (grab/move/resize). No controllers.
- **Server communication**: HTTP REST calls to existing Spaces API (WebSocket comes in Phase 2)
- **Scope**: Lobby + workspace rooms + pane placeholders. No live data, no voice.

---

## 1. Unity Project Structure

```
spaces-vr/
├── Assets/
│   ├── Scenes/
│   │   ├── Lobby.unity          # Central hub with workspace doors
│   │   └── WorkspaceRoom.unity  # Template room, instantiated per workspace
│   ├── Scripts/
│   │   ├── Core/
│   │   │   ├── SpacesConnection.cs    # HTTP client to Spaces API
│   │   │   ├── SessionManager.cs      # Auth token management
│   │   │   └── WorkspaceData.cs       # Data models (workspace, pane metadata)
│   │   ├── Lobby/
│   │   │   ├── LobbyManager.cs        # Spawn doors from workspace list
│   │   │   ├── WorkspaceDoor.cs       # Individual door behavior + preview
│   │   │   └── DoorInteraction.cs     # Gaze-select + confirm to enter
│   │   ├── Room/
│   │   │   ├── RoomManager.cs         # Arrange panes in semicircle, scale room
│   │   │   ├── PaneSurface.cs         # Pane placeholder (floating surface)
│   │   │   ├── PaneLayout.cs          # Semicircle positioning math
│   │   │   └── PaneInteraction.cs     # Grab, move, resize via hand tracking
│   │   ├── Interaction/
│   │   │   ├── GazeManager.cs         # Eye tracking → focused object
│   │   │   ├── GazeFocusHighlight.cs  # Visual feedback on gazed pane
│   │   │   ├── HandGrabHandler.cs     # Pinch-grab for pane manipulation
│   │   │   └── PalmMenu.cs            # Look-at-palm → home button
│   │   └── UI/
│   │       ├── PaneHeader.cs          # Agent name/type label on pane
│   │       └── StatusIndicator.cs     # Glow/color for pane state
│   ├── Prefabs/
│   │   ├── WorkspaceDoor.prefab
│   │   ├── PaneSurface.prefab
│   │   └── PalmMenu.prefab
│   ├── Materials/
│   │   ├── PaneSurface.mat       # Dark terminal-style surface
│   │   ├── PaneHighlight.mat     # Gaze-focus highlight shader
│   │   └── DoorFrame.mat         # Workspace door styling
│   └── Shaders/
│       └── TerminalSurface.shader  # SDF text rendering on pane surfaces
├── Packages/
│   └── manifest.json            # Meta XR SDK, Interaction SDK, TextMeshPro
├── ProjectSettings/
│   └── ...                      # Quest 3 build settings, eye/hand tracking permissions
└── README.md
```

---

## 2. Lobby

### Layout
A central circular or octagonal room. The user spawns at the center. Workspace doors are arranged around the perimeter, evenly spaced.

### Door Rendering
Each door is a prefab containing:
- **Frame** — archway or panel frame, tinted with the workspace's color (from Spaces API)
- **Label** — workspace name as TextMeshPro above the door
- **Preview panel** — small info card showing: pane count, active agent count, status color (green/amber/red)
- **Glow** — subtle ambient glow in the workspace color

### Data Fetching
On lobby load:
```
GET /api/workspaces → [{ id, name, color, paneCount, ... }]
```

`paneCount` is already returned by the workspaces endpoint (computed via JOIN). No need for a separate pane list call for lobby previews.

When entering a room:
```
GET /api/panes?workspace_id=N → [{ id, agent_type, title, ... }]
```

**Note:** The `GET /api/panes` route currently ignores query params and returns all active panes. Phase 1 requires adding `workspace_id` filter support to this route (small server-side change).

### Auth
Session cookie from `POST /api/auth/login` (when `@spaces/teams` is installed). Unity's `UnityWebRequest` supports cookies. If auth is not configured (Community tier, no login), the API is unauthenticated — `SpacesConnection.cs` should detect this and skip login.

### Server Unreachable State
If the server is unreachable on launch or during polling, the lobby shows a single "Offline" panel at center with the server URL and a "Retry" gaze-button. No doors rendered until connection succeeds.

### Entering a Room
- Gaze at a door for 1.5 seconds → confirmation ring fills around crosshair
- On confirm → fade to black (0.5s) → load workspace room → fade in (0.5s)
- Alternative: walk physically toward the door (proximity trigger at 1m)

---

## 3. Workspace Room

### Pane Arrangement
Panes are arranged in a semicircle at 2m radius from room center, at standing eye height (~1.6m). Arrangement adapts to pane count:

| Panes | Arc | Spacing |
|-------|-----|---------|
| 1 | Directly ahead | — |
| 2 | ±20° from center | 40° apart |
| 3-4 | ±40° arc | Even spacing |
| 5-6 | ±60° arc | Even spacing |
| 7-8 | ±80° arc | Even spacing |

Panes angle inward to face the user (billboarded on the Y axis only — they tilt toward center, not toward the user's head).

### Room Scaling
The room environment subtly scales with pane count:
- 1-2 panes: small office feel, warm lighting
- 3-5 panes: standard room
- 6-8 panes: larger space, cooler lighting, slight command-center vibe

### Pane Placeholder Surface
Each pane is a floating quad (default 1.2m wide × 0.8m tall, ~16:10 ratio). In Phase 1, it shows:
- Dark background (matching Spaces terminal theme: `#0a0a0f`)
- Pane header bar: agent name, agent type icon, workspace color accent
- Placeholder text: "Connecting..." or agent type name
- Status indicator: colored dot (green=active, gray=idle, amber=waiting, red=error)

### Returning to Lobby
- Look at open palm → palm menu appears (small floating UI near hand)
- Gaze at "Home" icon for 1s → fade transition back to lobby
- Voice shortcut: say "go home" (Phase 4 — do not wire in Phase 1)

---

## 4. Eye Tracking (Gaze)

### Setup
- Enable `Eye Tracking` in OVRManager
- Request runtime eye tracking permission (Quest 3 requires user consent)
- Use `OVREyeGaze` component to get gaze ray
- Raycast from gaze origin in gaze direction each frame
- **Fallback**: if user denies eye tracking permission, fall back to head-gaze (raycast from `OVRCameraRig.centerEyeAnchor.forward`). All interaction works the same, just less precise.

### Focus System
- When gaze ray hits a `PaneSurface` collider, that pane becomes "focused"
- Focus requires 300ms of sustained gaze (prevents flicker from glancing)
- On focus: pane border brightens, slight scale-up (1.02x), subtle audio tick
- On unfocus: reverse the highlight over 200ms
- Only one pane can be focused at a time
- When no pane is focused after 2s, a subtle "resting" state — all panes equally dim

### Gaze Cursor
- No visible crosshair/reticle in normal use (breaks immersion)
- During door selection or palm menu: a thin ring appears as the confirmation timer

---

## 5. Hand Tracking

### Grab to Move
- Pinch (thumb + index) while hand overlaps pane collider → grab
- While grabbed: pane follows hand position (with smoothing, 10ms lerp)
- Release pinch → pane stays at new position
- Constraint: panes stay between 1m and 4m from room center, and between 0.5m and 3m height

### Pinch to Resize
- Two-hand pinch: grab corners/edges with both hands
- Pull apart → scale up, push together → scale down
- Minimum size: 0.6m × 0.4m, Maximum: 2.4m × 1.6m
- Aspect ratio preserved during resize

### Scroll (Optional stretch — needed in Phase 3)
- Pinch and drag vertically near a pane surface (not grabbing the pane itself) → scroll
- If time permits, wire the gesture handler with a no-op callback. Otherwise defer entirely.

---

## 6. Server Communication (Phase 1 Scope)

Phase 1 uses **HTTP only** — just enough to populate the lobby and rooms.

### SpacesConnection.cs
```csharp
// Configurable server URL (default: http://localhost:3457)
// Auth: POST /api/auth/login → session token stored in SessionManager
// Workspace list: GET /api/workspaces → WorkspaceData[]
// Pane list: GET /api/panes?workspace_id=N → PaneData[]
// Polling: refresh workspace list every 30s while in lobby
//          refresh pane list every 10s while in a room
```

### Data Models
```csharp
[Serializable]
public class WorkspaceData {
    public int id;
    public string name;
    public string color;
    public int paneCount;    // from GET /api/workspaces (already computed server-side)
}

[Serializable]
public class PaneData {
    public string id;
    public string agentType;  // "claude", "codex", "shell", etc.
    public string title;
}
```

**Note on pane status:** The DB has no `status` column. For Phase 1, all pane placeholders show as "idle" (gray dot). Phase 2's WebSocket connection will provide real-time status updates. The `StatusIndicator` component should accept a status enum but default to idle for now.

---

## 7. Performance Budget

Target: 90fps (11.1ms frame time), 5ms GPU budget on Quest 3 (Adreno 740).

| Scene | Triangle Budget | Draw Calls | Texture Memory |
|-------|----------------|------------|----------------|
| Lobby (8 doors) | 50K | 20 | 64MB |
| Room (8 panes) | 100K | 30 | 128MB |

- Pane surfaces: simple quads with SDF text shader. No post-processing.
- Fixed foveated rendering: High (reduces peripheral pixel count by ~50%)
- Room geometry: low-poly, baked lighting, no real-time shadows
- TextMeshPro: SDF font atlas, single material per font size

### HTTP Polling & Error Handling
- Lobby polls workspace list every 30s. Room polls pane list every 10s.
- Timeout: 5s per request. On timeout: skip this poll cycle, retry next interval.
- 3 consecutive failures: show "Connection Lost" overlay, switch to 60s retry interval.
- On reconnect: refresh all data immediately, resume normal polling.
- Auth token expiry: re-attempt login once, show "Session Expired" if login fails.

---

## 8. Build & Test

### Development Without Headset
- **Meta XR Simulator** in Unity Editor: simulates eye tracking, hand tracking, room-scale movement
- Keyboard shortcuts: WASD move, mouse look, click to simulate gaze confirm
- All pane interaction testable in editor play mode

### Quest 3 Build Settings
- Target: Android (ARM64)
- Graphics API: Vulkan
- Min SDK: Android 12 (API 32)
- Enable: Eye Tracking, Hand Tracking, Passthrough (for Phase 5)
- Refresh rate: 90Hz target, 72Hz fallback
- Fixed foveated rendering: High (performance optimization)

### Testing with Headset
- Quest Link for live iteration (USB-C or Air Link over WiFi)
- SideQuest for standalone APK deployment
- Server must be reachable from Quest (same network, or port forwarded)

---

## 9. Out of Scope (Later Phases)

- Live terminal output rendering (Phase 3)
- WebSocket streaming (Phase 2)
- Voice input/output (Phase 4)
- Spatial audio (Phase 4)
- Pane position persistence (Phase 5)
- Passthrough/MR mode (Phase 5)
- Attention signals (chime/glow) for panes needing input (Phase 4)
- Room ambiance, lighting, polish (Phase 5)

---

## 10. Success Criteria

Phase 1 is done when:
1. You put on the Quest 3 (or run in Meta XR Simulator) and see a lobby with doors for your actual workspaces
2. You look at a door and the confirmation ring fills — you enter the room
3. Inside, pane placeholders are arranged in a semicircle with correct agent names/types
4. You can grab a pane with your hand and move it to a new position
5. You can resize a pane with two-hand pinch
6. Looking at a pane highlights it (eye tracking focus)
7. Palm menu returns you to the lobby
8. It runs at 90fps on Quest 3
