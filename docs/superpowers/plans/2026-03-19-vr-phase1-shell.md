# Spaces VR Phase 1: Shell + Static Rooms — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native Meta Quest 3 VR app that connects to a running Spaces server and renders workspace rooms with pane placeholders, navigable via eye tracking and hand tracking.

**Architecture:** Unity project (`C:\projects\spaces-vr`) with Meta XR SDK. HTTP client polls Spaces server API. Two scenes: Lobby (doors per workspace) and WorkspaceRoom (pane placeholders in semicircle). Eye tracking for gaze focus, hand tracking for grab/move/resize.

**Tech Stack:** Unity 2022.3 LTS, C#, Meta XR SDK v68+, Meta Interaction SDK, TextMeshPro, UnityWebRequest

**Spec:** `docs/superpowers/specs/2026-03-19-vr-phase1-shell-design.md`

**Important:** This is a Unity project. Many steps involve Unity Editor operations (creating scenes, configuring components, building prefabs) that cannot be fully automated via code. The plan provides exact C# scripts and documents which Editor steps are needed.

---

### Task 0: Server-Side — Add workspace_id Filter to Panes API

**Context:** The VR client needs to fetch panes for a specific workspace. The current `GET /api/panes` route only returns panes for the active workspace. We need to support `?workspace_id=N`.

**Files:**
- Modify: `C:\projects\spaces\src\app\api\panes\route.ts`

- [ ] **Step 1: Update the GET handler to accept workspace_id query param**

Replace the GET handler in `src/app/api/panes/route.ts`:

```typescript
export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');
    if (workspaceId) {
      const { getPanesByWorkspace } = await import('@/lib/db/queries');
      return NextResponse.json(getPanesByWorkspace(parseInt(workspaceId, 10)));
    }
    return NextResponse.json(getActivePanes());
  });
}
```

Add `getPanesByWorkspace` to the imports if not already imported:
```typescript
import { getActivePanes, createPane, getPanesByWorkspace } from '@/lib/db/queries';
```

- [ ] **Step 2: Verify the change**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd C:\projects\spaces
git add src/app/api/panes/route.ts
git commit -m "feat: add workspace_id filter to GET /api/panes for VR client"
```

---

### Task 1: Unity Project Setup

**Context:** Create the Unity project and configure it for Quest 3 development. This task is mostly Unity Editor work.

- [ ] **Step 1: Create the Unity project**

Open Unity Hub → New Project → 3D (URP) template → Project name: `spaces-vr` → Location: `C:\projects\` → Create Project

- [ ] **Step 2: Initialize git**

```bash
cd C:\projects\spaces-vr
git init
```

Create `.gitignore`:

```
# Unity
[Ll]ibrary/
[Tt]emp/
[Oo]bj/
[Bb]uild/
[Bb]uilds/
[Ll]ogs/
[Uu]ser[Ss]ettings/
*.csproj
*.unityproj
*.sln
*.suo
*.tmp
*.user
*.userprefs
*.pidb
*.booproj
*.svd
*.pdb
*.mdb
*.opendb
*.VC.db
*.pidb.meta
*.pdb.meta
*.mdb.meta
crashlytics-buildid.txt
sysinfo.txt
*.apk
*.aab
*.unitypackage
*.unitypackage.meta
```

```bash
git add .gitignore
git commit -m "chore: initialize spaces-vr Unity project"
```

- [ ] **Step 3: Configure build settings for Quest 3**

In Unity Editor:
1. File → Build Settings → Switch Platform to **Android**
2. Player Settings:
   - Other Settings → Scripting Backend: **IL2CPP**
   - Other Settings → Target Architectures: check **ARM64** only
   - Other Settings → Minimum API Level: **Android 12.0 (API 32)**
   - Other Settings → Graphics APIs: **Vulkan** only (remove OpenGLES)
   - Company Name: `Spaces`
   - Product Name: `Spaces VR`
   - Package Name: `com.spaces.vr`

- [ ] **Step 4: Install Meta XR SDK packages**

In Unity: Window → Package Manager → + → Add by name:
- `com.meta.xr.sdk.all` (Meta XR All-in-One SDK)

This pulls in OVR, Interaction SDK, and all Quest features.

After import, accept any "Fix All" prompts from the Meta Project Setup Tool.

- [ ] **Step 5: Configure OVR settings**

1. In Hierarchy, delete the default Main Camera
2. Add: right-click → XR → OVR Camera Rig
3. On the OVRCameraRig, in OVRManager:
   - Target Devices: Quest 3
   - Tracking Origin Type: Floor Level
   - Hand Tracking Support: Controllers and Hands
   - Eye Tracking Support: Supported (check "Required" = false for fallback)
4. Edit → Project Settings → XR Plug-in Management → check **Oculus**
5. Edit → Project Settings → Meta XR → check: Eye Tracking, Hand Tracking

- [ ] **Step 6: Create folder structure**

In Unity Project window, create these folders:
```
Assets/
├── Scenes/
├── Scripts/
│   ├── Core/
│   ├── Lobby/
│   ├── Room/
│   ├── Interaction/
│   └── UI/
├── Prefabs/
├── Materials/
└── Shaders/
```

- [ ] **Step 7: Commit**

```bash
cd C:\projects\spaces-vr
git add -A
git commit -m "feat: configure Unity project for Quest 3 with Meta XR SDK"
```

---

### Task 2: Data Models and Server Connection

**Files:**
- Create: `Assets/Scripts/Core/WorkspaceData.cs`
- Create: `Assets/Scripts/Core/SpacesConnection.cs`
- Create: `Assets/Scripts/Core/SessionManager.cs`

- [ ] **Step 1: Create data models**

```csharp
// Assets/Scripts/Core/WorkspaceData.cs
using System;
using System.Collections.Generic;

[Serializable]
public class WorkspaceData
{
    public int id;
    public string name;
    public string color;
    public int paneCount;
}

[Serializable]
public class PaneData
{
    public string id;
    public string agentType;
    public string title;
}

[Serializable]
public class WorkspaceListResponse
{
    public List<WorkspaceData> items;
}

// Helper to deserialize JSON array (Unity's JsonUtility doesn't handle top-level arrays)
public static class JsonArrayHelper
{
    public static List<T> FromJson<T>(string json)
    {
        string wrapped = "{\"items\":" + json + "}";
        var wrapper = UnityEngine.JsonUtility.FromJson<Wrapper<T>>(wrapped);
        return wrapper.items;
    }

    [Serializable]
    private class Wrapper<T>
    {
        public List<T> items;
    }
}
```

- [ ] **Step 2: Create session manager**

```csharp
// Assets/Scripts/Core/SessionManager.cs
using UnityEngine;

public class SessionManager : MonoBehaviour
{
    public static SessionManager Instance { get; private set; }

    public string ServerUrl { get; set; } = "http://localhost:3457";
    public string SessionCookie { get; private set; }
    public bool IsAuthenticated => !string.IsNullOrEmpty(SessionCookie);

    private void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    public void SetCookie(string cookie)
    {
        SessionCookie = cookie;
    }

    public void ClearSession()
    {
        SessionCookie = null;
    }
}
```

- [ ] **Step 3: Create HTTP connection client**

```csharp
// Assets/Scripts/Core/SpacesConnection.cs
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

public class SpacesConnection : MonoBehaviour
{
    public static SpacesConnection Instance { get; private set; }

    [SerializeField] private float workspacePollingInterval = 30f;
    [SerializeField] private float panePollingInterval = 10f;
    [SerializeField] private float requestTimeout = 5f;
    [SerializeField] private int maxConsecutiveFailures = 3;

    public event Action<List<WorkspaceData>> OnWorkspacesUpdated;
    public event Action<List<PaneData>> OnPanesUpdated;
    public event Action<bool> OnConnectionStateChanged;

    private int consecutiveFailures;
    private bool isConnected;

    private void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    private string BaseUrl => SessionManager.Instance.ServerUrl;

    public IEnumerator FetchWorkspaces(Action<List<WorkspaceData>> callback)
    {
        using var req = UnityWebRequest.Get($"{BaseUrl}/api/workspaces");
        req.timeout = (int)requestTimeout;
        if (SessionManager.Instance.IsAuthenticated)
            req.SetRequestHeader("Cookie", SessionManager.Instance.SessionCookie);

        yield return req.SendWebRequest();

        if (req.result == UnityWebRequest.Result.Success)
        {
            consecutiveFailures = 0;
            if (!isConnected) { isConnected = true; OnConnectionStateChanged?.Invoke(true); }

            var workspaces = JsonArrayHelper.FromJson<WorkspaceData>(req.downloadHandler.text);
            callback?.Invoke(workspaces);
            OnWorkspacesUpdated?.Invoke(workspaces);
        }
        else
        {
            HandleFailure();
            callback?.Invoke(null);
        }
    }

    public IEnumerator FetchPanes(int workspaceId, Action<List<PaneData>> callback)
    {
        using var req = UnityWebRequest.Get($"{BaseUrl}/api/panes?workspace_id={workspaceId}");
        req.timeout = (int)requestTimeout;
        if (SessionManager.Instance.IsAuthenticated)
            req.SetRequestHeader("Cookie", SessionManager.Instance.SessionCookie);

        yield return req.SendWebRequest();

        if (req.result == UnityWebRequest.Result.Success)
        {
            consecutiveFailures = 0;
            var panes = JsonArrayHelper.FromJson<PaneData>(req.downloadHandler.text);
            callback?.Invoke(panes);
            OnPanesUpdated?.Invoke(panes);
        }
        else
        {
            HandleFailure();
            callback?.Invoke(null);
        }
    }

    public IEnumerator TryConnect(Action<bool> callback)
    {
        // Try unauthenticated first
        using var req = UnityWebRequest.Get($"{BaseUrl}/api/workspaces");
        req.timeout = (int)requestTimeout;
        yield return req.SendWebRequest();

        if (req.result == UnityWebRequest.Result.Success)
        {
            isConnected = true;
            OnConnectionStateChanged?.Invoke(true);
            callback?.Invoke(true);
        }
        else if (req.responseCode == 401)
        {
            // Auth required — need login UI (Phase 1: show message)
            Debug.Log("[SpacesVR] Server requires authentication");
            callback?.Invoke(false);
        }
        else
        {
            HandleFailure();
            callback?.Invoke(false);
        }
    }

    private void HandleFailure()
    {
        consecutiveFailures++;
        if (consecutiveFailures >= maxConsecutiveFailures && isConnected)
        {
            isConnected = false;
            OnConnectionStateChanged?.Invoke(false);
        }
    }

    // Coroutine-based polling helpers
    public IEnumerator PollWorkspaces()
    {
        while (true)
        {
            yield return FetchWorkspaces(null);
            yield return new WaitForSeconds(workspacePollingInterval);
        }
    }

    public IEnumerator PollPanes(int workspaceId)
    {
        while (true)
        {
            yield return FetchPanes(workspaceId, null);
            yield return new WaitForSeconds(panePollingInterval);
        }
    }
}
```

- [ ] **Step 4: Commit**

```bash
cd C:\projects\spaces-vr
git add Assets/Scripts/Core/
git commit -m "feat: add data models and HTTP connection client"
```

---

### Task 3: Gaze Manager (Eye Tracking + Fallback)

**Files:**
- Create: `Assets/Scripts/Interaction/GazeManager.cs`
- Create: `Assets/Scripts/Interaction/GazeFocusHighlight.cs`

- [ ] **Step 1: Create GazeManager**

```csharp
// Assets/Scripts/Interaction/GazeManager.cs
using UnityEngine;

public class GazeManager : MonoBehaviour
{
    public static GazeManager Instance { get; private set; }

    [SerializeField] private float focusDelay = 0.3f; // 300ms sustained gaze
    [SerializeField] private float unfocusDelay = 0.2f;
    [SerializeField] private float maxRayDistance = 20f;
    [SerializeField] private LayerMask gazeLayerMask = ~0;

    public GameObject FocusedObject { get; private set; }
    public RaycastHit? LastHit { get; private set; }
    public event System.Action<GameObject> OnFocusChanged;

    private OVREyeGaze leftEyeGaze;
    private OVREyeGaze rightEyeGaze;
    private bool useEyeTracking;
    private Transform centerEye;

    private GameObject candidateObject;
    private float candidateTime;
    private float unfocusTime;

    private void Awake()
    {
        if (Instance != null) { Destroy(gameObject); return; }
        Instance = this;
    }

    private void Start()
    {
        // Try to find eye tracking components
        var eyeGazes = FindObjectsOfType<OVREyeGaze>();
        foreach (var eg in eyeGazes)
        {
            if (eg.Eye == OVREyeGaze.EyeId.Combined || eg.Eye == OVREyeGaze.EyeId.Left)
                leftEyeGaze = eg;
        }

        // Find center eye anchor for fallback
        var rig = FindObjectOfType<OVRCameraRig>();
        if (rig != null) centerEye = rig.centerEyeAnchor;

        // Check if eye tracking is available
        useEyeTracking = OVRPlugin.eyeTrackingEnabled;
        if (!useEyeTracking)
            Debug.Log("[GazeManager] Eye tracking unavailable, using head-gaze fallback");
    }

    private void Update()
    {
        Ray gazeRay = GetGazeRay();
        RaycastHit hit;
        bool didHit = Physics.Raycast(gazeRay, out hit, maxRayDistance, gazeLayerMask);

        if (didHit)
        {
            LastHit = hit;
            var hitObj = hit.collider.gameObject;

            if (hitObj == FocusedObject)
            {
                // Still looking at focused object — reset unfocus timer
                unfocusTime = 0f;
            }
            else if (hitObj == candidateObject)
            {
                // Still looking at candidate — accumulate focus time
                candidateTime += Time.deltaTime;
                if (candidateTime >= focusDelay)
                {
                    SetFocus(hitObj);
                }
            }
            else
            {
                // New candidate
                candidateObject = hitObj;
                candidateTime = 0f;
            }
        }
        else
        {
            LastHit = null;
            candidateObject = null;
            candidateTime = 0f;

            if (FocusedObject != null)
            {
                unfocusTime += Time.deltaTime;
                if (unfocusTime >= unfocusDelay)
                {
                    SetFocus(null);
                }
            }
        }
    }

    private Ray GetGazeRay()
    {
        if (useEyeTracking && leftEyeGaze != null)
        {
            return new Ray(leftEyeGaze.transform.position, leftEyeGaze.transform.forward);
        }

        // Head-gaze fallback
        if (centerEye != null)
        {
            return new Ray(centerEye.position, centerEye.forward);
        }

        return new Ray(Camera.main.transform.position, Camera.main.transform.forward);
    }

    private void SetFocus(GameObject obj)
    {
        if (FocusedObject == obj) return;

        // Notify old object
        if (FocusedObject != null)
        {
            var highlight = FocusedObject.GetComponent<GazeFocusHighlight>();
            if (highlight != null) highlight.OnUnfocus();
        }

        FocusedObject = obj;
        unfocusTime = 0f;
        candidateObject = null;
        candidateTime = 0f;

        // Notify new object
        if (FocusedObject != null)
        {
            var highlight = FocusedObject.GetComponent<GazeFocusHighlight>();
            if (highlight != null) highlight.OnFocus();
        }

        OnFocusChanged?.Invoke(FocusedObject);
    }
}
```

- [ ] **Step 2: Create GazeFocusHighlight**

```csharp
// Assets/Scripts/Interaction/GazeFocusHighlight.cs
using UnityEngine;

public class GazeFocusHighlight : MonoBehaviour
{
    [SerializeField] private float highlightScale = 1.02f;
    [SerializeField] private float transitionSpeed = 8f;
    [SerializeField] private Color highlightColor = new Color(0.5f, 0.3f, 1f, 0.3f); // purple glow

    private Vector3 originalScale;
    private bool isFocused;
    private float focusLerp; // 0 = unfocused, 1 = focused
    private Renderer[] renderers;
    private MaterialPropertyBlock propBlock;

    private void Awake()
    {
        originalScale = transform.localScale;
        renderers = GetComponentsInChildren<Renderer>();
        propBlock = new MaterialPropertyBlock();
    }

    private void Update()
    {
        float target = isFocused ? 1f : 0f;
        focusLerp = Mathf.MoveTowards(focusLerp, target, Time.deltaTime * transitionSpeed);

        // Scale
        transform.localScale = Vector3.Lerp(originalScale, originalScale * highlightScale, focusLerp);

        // Emission glow
        foreach (var r in renderers)
        {
            r.GetPropertyBlock(propBlock);
            propBlock.SetColor("_EmissionColor", highlightColor * focusLerp);
            r.SetPropertyBlock(propBlock);
        }
    }

    public void OnFocus()
    {
        isFocused = true;
    }

    public void OnUnfocus()
    {
        isFocused = false;
    }
}
```

- [ ] **Step 3: Commit**

```bash
cd C:\projects\spaces-vr
git add Assets/Scripts/Interaction/GazeManager.cs Assets/Scripts/Interaction/GazeFocusHighlight.cs
git commit -m "feat: add gaze manager with eye tracking and head-gaze fallback"
```

---

### Task 4: Pane Layout Math and Pane Surface

**Files:**
- Create: `Assets/Scripts/Room/PaneLayout.cs`
- Create: `Assets/Scripts/Room/PaneSurface.cs`
- Create: `Assets/Scripts/UI/PaneHeader.cs`
- Create: `Assets/Scripts/UI/StatusIndicator.cs`

- [ ] **Step 1: Create PaneLayout (semicircle positioning)**

```csharp
// Assets/Scripts/Room/PaneLayout.cs
using UnityEngine;

public static class PaneLayout
{
    public static Vector3[] ComputePositions(int paneCount, float radius = 2f, float eyeHeight = 1.6f)
    {
        if (paneCount <= 0) return new Vector3[0];

        var positions = new Vector3[paneCount];

        if (paneCount == 1)
        {
            positions[0] = new Vector3(0, eyeHeight, radius);
            return positions;
        }

        // Arc grows with pane count
        float totalArcDeg;
        if (paneCount <= 2) totalArcDeg = 40f;
        else if (paneCount <= 4) totalArcDeg = 80f;
        else if (paneCount <= 6) totalArcDeg = 120f;
        else totalArcDeg = 160f;

        float startAngle = 90f - totalArcDeg / 2f; // center the arc at 90° (forward)
        float step = totalArcDeg / (paneCount - 1);

        for (int i = 0; i < paneCount; i++)
        {
            float angleDeg = startAngle + step * i;
            float angleRad = angleDeg * Mathf.Deg2Rad;
            float x = Mathf.Cos(angleRad) * radius;
            float z = Mathf.Sin(angleRad) * radius;
            positions[i] = new Vector3(x, eyeHeight, z);
        }

        return positions;
    }

    public static Quaternion ComputeRotation(Vector3 panePosition)
    {
        // Face inward toward room center (Y-axis billboard only)
        Vector3 toCenter = -new Vector3(panePosition.x, 0, panePosition.z).normalized;
        return Quaternion.LookRotation(toCenter, Vector3.up);
    }
}
```

- [ ] **Step 2: Create StatusIndicator**

```csharp
// Assets/Scripts/UI/StatusIndicator.cs
using UnityEngine;

public enum PaneStatus
{
    Idle,      // gray
    Active,    // green
    Waiting,   // amber
    Error      // red
}

public class StatusIndicator : MonoBehaviour
{
    [SerializeField] private Renderer dotRenderer;

    private static readonly Color IdleColor = new Color(0.4f, 0.4f, 0.4f);
    private static readonly Color ActiveColor = new Color(0.2f, 0.8f, 0.2f);
    private static readonly Color WaitingColor = new Color(0.9f, 0.7f, 0.1f);
    private static readonly Color ErrorColor = new Color(0.9f, 0.2f, 0.2f);

    private MaterialPropertyBlock propBlock;

    private void Awake()
    {
        propBlock = new MaterialPropertyBlock();
    }

    public void SetStatus(PaneStatus status)
    {
        Color c = status switch
        {
            PaneStatus.Active => ActiveColor,
            PaneStatus.Waiting => WaitingColor,
            PaneStatus.Error => ErrorColor,
            _ => IdleColor,
        };

        if (dotRenderer != null)
        {
            dotRenderer.GetPropertyBlock(propBlock);
            propBlock.SetColor("_Color", c);
            propBlock.SetColor("_EmissionColor", c * 0.5f);
            dotRenderer.SetPropertyBlock(propBlock);
        }
    }
}
```

- [ ] **Step 3: Create PaneHeader**

```csharp
// Assets/Scripts/UI/PaneHeader.cs
using TMPro;
using UnityEngine;

public class PaneHeader : MonoBehaviour
{
    [SerializeField] private TextMeshPro titleText;
    [SerializeField] private TextMeshPro subtitleText;
    [SerializeField] private Renderer accentBar;

    private MaterialPropertyBlock propBlock;

    private void Awake()
    {
        propBlock = new MaterialPropertyBlock();
    }

    public void SetInfo(string agentType, string title, Color workspaceColor)
    {
        if (titleText != null)
            titleText.text = string.IsNullOrEmpty(title) ? agentType : title;

        if (subtitleText != null)
            subtitleText.text = agentType;

        if (accentBar != null)
        {
            accentBar.GetPropertyBlock(propBlock);
            propBlock.SetColor("_Color", workspaceColor);
            accentBar.SetPropertyBlock(propBlock);
        }
    }
}
```

- [ ] **Step 4: Create PaneSurface**

```csharp
// Assets/Scripts/Room/PaneSurface.cs
using TMPro;
using UnityEngine;

[RequireComponent(typeof(BoxCollider))]
[RequireComponent(typeof(GazeFocusHighlight))]
public class PaneSurface : MonoBehaviour
{
    [SerializeField] private TextMeshPro contentText;
    [SerializeField] private PaneHeader header;
    [SerializeField] private StatusIndicator statusIndicator;

    public string PaneId { get; private set; }
    public PaneData Data { get; private set; }

    private static readonly Vector3 DefaultSize = new Vector3(1.2f, 0.8f, 0.01f);
    private static readonly Vector3 MinSize = new Vector3(0.6f, 0.4f, 0.01f);
    private static readonly Vector3 MaxSize = new Vector3(2.4f, 1.6f, 0.01f);

    public void Initialize(PaneData data, Color workspaceColor)
    {
        Data = data;
        PaneId = data.id;

        header?.SetInfo(data.agentType, data.title, workspaceColor);
        statusIndicator?.SetStatus(PaneStatus.Idle); // Phase 1: always idle

        if (contentText != null)
            contentText.text = $"<color=#666>{data.agentType}\nConnecting...</color>";
    }

    public void SetSize(Vector3 newSize)
    {
        newSize.x = Mathf.Clamp(newSize.x, MinSize.x, MaxSize.x);
        newSize.y = Mathf.Clamp(newSize.y, MinSize.y, MaxSize.y);
        newSize.z = DefaultSize.z;
        transform.localScale = newSize;
    }
}
```

- [ ] **Step 5: Commit**

```bash
cd C:\projects\spaces-vr
git add Assets/Scripts/Room/ Assets/Scripts/UI/
git commit -m "feat: add pane layout, surface, header, and status indicator"
```

---

### Task 5: Hand Tracking — Grab and Resize

**Files:**
- Create: `Assets/Scripts/Interaction/HandGrabHandler.cs`

- [ ] **Step 1: Create HandGrabHandler**

```csharp
// Assets/Scripts/Interaction/HandGrabHandler.cs
using UnityEngine;

public class HandGrabHandler : MonoBehaviour
{
    [SerializeField] private OVRHand leftHand;
    [SerializeField] private OVRHand rightHand;
    [SerializeField] private float grabDistance = 0.15f;
    [SerializeField] private float smoothing = 15f;
    [SerializeField] private float minDistFromCenter = 1f;
    [SerializeField] private float maxDistFromCenter = 4f;
    [SerializeField] private float minHeight = 0.5f;
    [SerializeField] private float maxHeight = 3f;

    private PaneSurface grabbedPane;
    private Transform grabbingHand;
    private Vector3 grabOffset;

    // Two-hand resize state
    private bool isResizing;
    private float initialPinchDistance;
    private Vector3 initialPaneScale;

    private void Update()
    {
        bool leftPinch = leftHand != null && leftHand.GetFingerIsPinching(OVRHand.HandFinger.Index);
        bool rightPinch = rightHand != null && rightHand.GetFingerIsPinching(OVRHand.HandFinger.Index);

        // Two-hand resize
        if (leftPinch && rightPinch && grabbedPane != null)
        {
            HandleResize();
            return;
        }

        if (isResizing)
        {
            isResizing = false;
        }

        // Single-hand grab
        if (!leftPinch && !rightPinch)
        {
            grabbedPane = null;
            grabbingHand = null;
            return;
        }

        Transform activeHand = leftPinch ? leftHand.transform : rightHand.transform;

        if (grabbedPane == null)
        {
            // Try to grab
            TryGrab(activeHand);
        }
        else if (grabbingHand == activeHand)
        {
            // Move grabbed pane
            MoveGrabbedPane();
        }
    }

    private void TryGrab(Transform hand)
    {
        Collider[] hits = Physics.OverlapSphere(hand.position, grabDistance);
        foreach (var hit in hits)
        {
            var pane = hit.GetComponent<PaneSurface>();
            if (pane != null)
            {
                grabbedPane = pane;
                grabbingHand = hand;
                grabOffset = pane.transform.position - hand.position;
                return;
            }
        }
    }

    private void MoveGrabbedPane()
    {
        Vector3 targetPos = grabbingHand.position + grabOffset;

        // Constrain position
        float dist = new Vector2(targetPos.x, targetPos.z).magnitude;
        if (dist < minDistFromCenter || dist > maxDistFromCenter)
        {
            Vector2 dir = new Vector2(targetPos.x, targetPos.z).normalized;
            dist = Mathf.Clamp(dist, minDistFromCenter, maxDistFromCenter);
            targetPos.x = dir.x * dist;
            targetPos.z = dir.y * dist;
        }
        targetPos.y = Mathf.Clamp(targetPos.y, minHeight, maxHeight);

        grabbedPane.transform.position = Vector3.Lerp(
            grabbedPane.transform.position, targetPos, Time.deltaTime * smoothing);

        // Re-orient to face center
        grabbedPane.transform.rotation = PaneLayout.ComputeRotation(grabbedPane.transform.position);
    }

    private void HandleResize()
    {
        float currentDist = Vector3.Distance(leftHand.transform.position, rightHand.transform.position);

        if (!isResizing)
        {
            isResizing = true;
            initialPinchDistance = currentDist;
            initialPaneScale = grabbedPane.transform.localScale;
            return;
        }

        float scaleFactor = currentDist / initialPinchDistance;
        Vector3 newScale = initialPaneScale * scaleFactor;
        grabbedPane.SetSize(newScale);
    }
}
```

- [ ] **Step 2: Commit**

```bash
cd C:\projects\spaces-vr
git add Assets/Scripts/Interaction/HandGrabHandler.cs
git commit -m "feat: add hand tracking grab-to-move and pinch-to-resize"
```

---

### Task 6: Lobby Scene — Door Spawning and Navigation

**Files:**
- Create: `Assets/Scripts/Lobby/LobbyManager.cs`
- Create: `Assets/Scripts/Lobby/WorkspaceDoor.cs`
- Create: `Assets/Scripts/Lobby/DoorInteraction.cs`

- [ ] **Step 1: Create WorkspaceDoor**

```csharp
// Assets/Scripts/Lobby/WorkspaceDoor.cs
using TMPro;
using UnityEngine;

public class WorkspaceDoor : MonoBehaviour
{
    [SerializeField] private TextMeshPro nameLabel;
    [SerializeField] private TextMeshPro infoLabel;
    [SerializeField] private Renderer frameRenderer;
    [SerializeField] private Renderer glowRenderer;

    public WorkspaceData Data { get; private set; }

    private MaterialPropertyBlock propBlock;

    private void Awake()
    {
        propBlock = new MaterialPropertyBlock();
    }

    public void Initialize(WorkspaceData data)
    {
        Data = data;

        if (nameLabel != null) nameLabel.text = data.name;
        if (infoLabel != null) infoLabel.text = $"{data.paneCount} pane{(data.paneCount != 1 ? "s" : "")}";

        Color wsColor;
        if (!ColorUtility.TryParseHtmlString(data.color, out wsColor))
            wsColor = new Color(0.4f, 0.3f, 0.9f); // default purple

        if (frameRenderer != null)
        {
            frameRenderer.GetPropertyBlock(propBlock);
            propBlock.SetColor("_Color", wsColor);
            frameRenderer.SetPropertyBlock(propBlock);
        }

        if (glowRenderer != null)
        {
            glowRenderer.GetPropertyBlock(propBlock);
            propBlock.SetColor("_EmissionColor", wsColor * 0.3f);
            glowRenderer.SetPropertyBlock(propBlock);
        }
    }
}
```

- [ ] **Step 2: Create DoorInteraction (gaze-to-enter)**

```csharp
// Assets/Scripts/Lobby/DoorInteraction.cs
using UnityEngine;

[RequireComponent(typeof(GazeFocusHighlight))]
public class DoorInteraction : MonoBehaviour
{
    [SerializeField] private float confirmTime = 1.5f;
    [SerializeField] private Renderer confirmRing; // a progress ring UI element

    private float gazeTimer;
    private bool isGazed;
    private WorkspaceDoor door;
    private MaterialPropertyBlock propBlock;

    private void Awake()
    {
        door = GetComponent<WorkspaceDoor>();
        propBlock = new MaterialPropertyBlock();
    }

    private void OnEnable()
    {
        if (GazeManager.Instance != null)
            GazeManager.Instance.OnFocusChanged += HandleFocusChanged;
    }

    private void OnDisable()
    {
        if (GazeManager.Instance != null)
            GazeManager.Instance.OnFocusChanged -= HandleFocusChanged;
    }

    private void HandleFocusChanged(GameObject focused)
    {
        isGazed = (focused == gameObject);
        if (!isGazed)
        {
            gazeTimer = 0f;
            UpdateRing(0f);
        }
    }

    private void Update()
    {
        if (!isGazed) return;

        gazeTimer += Time.deltaTime;
        UpdateRing(gazeTimer / confirmTime);

        if (gazeTimer >= confirmTime)
        {
            gazeTimer = 0f;
            EnterWorkspace();
        }
    }

    private void UpdateRing(float progress)
    {
        if (confirmRing != null)
        {
            confirmRing.gameObject.SetActive(progress > 0f);
            confirmRing.GetPropertyBlock(propBlock);
            propBlock.SetFloat("_Progress", Mathf.Clamp01(progress));
            confirmRing.SetPropertyBlock(propBlock);
        }
    }

    private void EnterWorkspace()
    {
        if (door?.Data != null)
        {
            LobbyManager.Instance?.EnterWorkspace(door.Data);
        }
    }
}
```

- [ ] **Step 3: Create LobbyManager**

```csharp
// Assets/Scripts/Lobby/LobbyManager.cs
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class LobbyManager : MonoBehaviour
{
    public static LobbyManager Instance { get; private set; }

    [SerializeField] private GameObject doorPrefab;
    [SerializeField] private float doorRadius = 4f;
    [SerializeField] private float doorHeight = 0f;
    [SerializeField] private GameObject offlinePanel;
    [SerializeField] private RoomManager roomManager;

    private List<GameObject> spawnedDoors = new List<GameObject>();
    private Coroutine pollCoroutine;

    private void Awake()
    {
        Instance = this;
    }

    private IEnumerator Start()
    {
        // Initial connection attempt
        bool connected = false;
        yield return SpacesConnection.Instance.TryConnect(result => connected = result);

        if (connected)
        {
            yield return SpacesConnection.Instance.FetchWorkspaces(SpawnDoors);
            pollCoroutine = StartCoroutine(SpacesConnection.Instance.PollWorkspaces());
        }
        else
        {
            ShowOffline();
        }

        SpacesConnection.Instance.OnConnectionStateChanged += OnConnectionChanged;
        SpacesConnection.Instance.OnWorkspacesUpdated += SpawnDoors;
    }

    private void OnDestroy()
    {
        if (SpacesConnection.Instance != null)
        {
            SpacesConnection.Instance.OnConnectionStateChanged -= OnConnectionChanged;
            SpacesConnection.Instance.OnWorkspacesUpdated -= SpawnDoors;
        }
    }

    private void OnConnectionChanged(bool connected)
    {
        if (connected)
        {
            HideOffline();
            if (pollCoroutine == null)
                pollCoroutine = StartCoroutine(SpacesConnection.Instance.PollWorkspaces());
        }
        else
        {
            ShowOffline();
        }
    }

    private void SpawnDoors(List<WorkspaceData> workspaces)
    {
        if (workspaces == null) return;

        // Clear existing doors
        foreach (var d in spawnedDoors) Destroy(d);
        spawnedDoors.Clear();

        if (workspaces.Count == 0) return;

        float angleStep = 360f / workspaces.Count;

        for (int i = 0; i < workspaces.Count; i++)
        {
            float angleDeg = angleStep * i;
            float angleRad = angleDeg * Mathf.Deg2Rad;

            Vector3 pos = new Vector3(
                Mathf.Sin(angleRad) * doorRadius,
                doorHeight,
                Mathf.Cos(angleRad) * doorRadius
            );

            Quaternion rot = Quaternion.LookRotation(-pos.normalized, Vector3.up);

            var doorObj = Instantiate(doorPrefab, pos, rot, transform);
            var door = doorObj.GetComponent<WorkspaceDoor>();
            door?.Initialize(workspaces[i]);

            spawnedDoors.Add(doorObj);
        }
    }

    public void EnterWorkspace(WorkspaceData workspace)
    {
        // Stop lobby polling
        if (pollCoroutine != null)
        {
            StopCoroutine(pollCoroutine);
            pollCoroutine = null;
        }

        // Hide lobby objects
        foreach (var d in spawnedDoors) d.SetActive(false);

        // Activate room
        roomManager?.LoadWorkspace(workspace);
    }

    public void ReturnToLobby()
    {
        roomManager?.UnloadWorkspace();
        foreach (var d in spawnedDoors) d.SetActive(true);
        pollCoroutine = StartCoroutine(SpacesConnection.Instance.PollWorkspaces());
    }

    private void ShowOffline()
    {
        if (offlinePanel != null) offlinePanel.SetActive(true);
    }

    private void HideOffline()
    {
        if (offlinePanel != null) offlinePanel.SetActive(false);
    }
}
```

- [ ] **Step 4: Commit**

```bash
cd C:\projects\spaces-vr
git add Assets/Scripts/Lobby/
git commit -m "feat: add lobby with workspace doors and gaze-to-enter navigation"
```

---

### Task 7: Room Manager — Pane Spawning and Room Scaling

**Files:**
- Create: `Assets/Scripts/Room/RoomManager.cs`

- [ ] **Step 1: Create RoomManager**

```csharp
// Assets/Scripts/Room/RoomManager.cs
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class RoomManager : MonoBehaviour
{
    [SerializeField] private GameObject panePrefab;
    [SerializeField] private Light roomLight;
    [SerializeField] private Transform roomContainer;

    private List<GameObject> spawnedPanes = new List<GameObject>();
    private WorkspaceData currentWorkspace;
    private Coroutine pollCoroutine;

    // Room scaling light presets
    private static readonly Color WarmLight = new Color(1f, 0.9f, 0.8f);
    private static readonly Color NeutralLight = new Color(0.9f, 0.9f, 1f);
    private static readonly Color CoolLight = new Color(0.7f, 0.8f, 1f);

    public void LoadWorkspace(WorkspaceData workspace)
    {
        currentWorkspace = workspace;
        if (roomContainer != null) roomContainer.gameObject.SetActive(true);

        StartCoroutine(FetchAndSpawnPanes());
    }

    public void UnloadWorkspace()
    {
        if (pollCoroutine != null)
        {
            StopCoroutine(pollCoroutine);
            pollCoroutine = null;
        }

        foreach (var p in spawnedPanes) Destroy(p);
        spawnedPanes.Clear();

        currentWorkspace = null;
        if (roomContainer != null) roomContainer.gameObject.SetActive(false);
    }

    private IEnumerator FetchAndSpawnPanes()
    {
        yield return SpacesConnection.Instance.FetchPanes(currentWorkspace.id, SpawnPanes);
        pollCoroutine = StartCoroutine(SpacesConnection.Instance.PollPanes(currentWorkspace.id));
    }

    private void SpawnPanes(List<PaneData> panes)
    {
        if (panes == null) return;

        // Clear existing
        foreach (var p in spawnedPanes) Destroy(p);
        spawnedPanes.Clear();

        // Compute positions
        var positions = PaneLayout.ComputePositions(panes.Count);

        // Parse workspace color
        Color wsColor;
        if (!ColorUtility.TryParseHtmlString(currentWorkspace.color, out wsColor))
            wsColor = new Color(0.4f, 0.3f, 0.9f);

        // Scale room lighting based on pane count
        SetRoomLighting(panes.Count);

        // Spawn panes
        for (int i = 0; i < panes.Count; i++)
        {
            Vector3 pos = positions[i];
            Quaternion rot = PaneLayout.ComputeRotation(pos);

            Transform parent = roomContainer != null ? roomContainer : transform;
            var paneObj = Instantiate(panePrefab, pos, rot, parent);
            var surface = paneObj.GetComponent<PaneSurface>();
            surface?.Initialize(panes[i], wsColor);

            spawnedPanes.Add(paneObj);
        }
    }

    private void SetRoomLighting(int paneCount)
    {
        if (roomLight == null) return;

        if (paneCount <= 2)
        {
            roomLight.color = WarmLight;
            roomLight.intensity = 0.6f;
        }
        else if (paneCount <= 5)
        {
            roomLight.color = NeutralLight;
            roomLight.intensity = 0.8f;
        }
        else
        {
            roomLight.color = CoolLight;
            roomLight.intensity = 1.0f;
        }
    }
}
```

- [ ] **Step 2: Commit**

```bash
cd C:\projects\spaces-vr
git add Assets/Scripts/Room/RoomManager.cs
git commit -m "feat: add room manager with pane spawning and adaptive lighting"
```

---

### Task 8: Palm Menu (Return to Lobby)

**Files:**
- Create: `Assets/Scripts/Interaction/PalmMenu.cs`

- [ ] **Step 1: Create PalmMenu**

```csharp
// Assets/Scripts/Interaction/PalmMenu.cs
using UnityEngine;

public class PalmMenu : MonoBehaviour
{
    [SerializeField] private OVRHand hand; // left hand
    [SerializeField] private OVRSkeleton skeleton;
    [SerializeField] private GameObject menuPanel; // small floating UI
    [SerializeField] private Renderer homeButton;
    [SerializeField] private float palmUpThreshold = 0.7f; // dot product with up vector
    [SerializeField] private float gazeConfirmTime = 1.0f;

    private bool menuVisible;
    private float gazeTimer;
    private bool isGazingHome;
    private MaterialPropertyBlock propBlock;

    private void Awake()
    {
        propBlock = new MaterialPropertyBlock();
        if (menuPanel != null) menuPanel.SetActive(false);
    }

    private void Update()
    {
        UpdateMenuVisibility();
        if (menuVisible) UpdateGazeConfirm();
    }

    private void UpdateMenuVisibility()
    {
        if (hand == null || skeleton == null)
        {
            SetMenuVisible(false);
            return;
        }

        // Check if palm is facing up
        if (skeleton.Bones == null || skeleton.Bones.Count == 0)
        {
            SetMenuVisible(false);
            return;
        }

        // Use wrist bone orientation to determine palm facing
        Transform wrist = skeleton.Bones[(int)OVRSkeleton.BoneId.Hand_WristRoot]?.Transform;
        if (wrist == null) { SetMenuVisible(false); return; }

        float palmDot = Vector3.Dot(wrist.up, Vector3.up);
        bool palmUp = palmDot > palmUpThreshold;

        // Also check if user is looking at their palm
        bool lookingAtPalm = false;
        if (GazeManager.Instance?.LastHit != null)
        {
            float distToHand = Vector3.Distance(
                GazeManager.Instance.LastHit.Value.point, wrist.position);
            lookingAtPalm = distToHand < 0.2f;
        }

        SetMenuVisible(palmUp && lookingAtPalm);
    }

    private void SetMenuVisible(bool visible)
    {
        if (menuVisible == visible) return;
        menuVisible = visible;
        if (menuPanel != null) menuPanel.SetActive(visible);
        if (!visible) gazeTimer = 0f;
    }

    private void UpdateGazeConfirm()
    {
        // Check if gaze is on the home button
        var focused = GazeManager.Instance?.FocusedObject;
        if (focused != null && focused == homeButton?.gameObject)
        {
            gazeTimer += Time.deltaTime;

            // Update progress ring
            if (homeButton != null)
            {
                homeButton.GetPropertyBlock(propBlock);
                propBlock.SetFloat("_Progress", gazeTimer / gazeConfirmTime);
                homeButton.SetPropertyBlock(propBlock);
            }

            if (gazeTimer >= gazeConfirmTime)
            {
                gazeTimer = 0f;
                ReturnToLobby();
            }
        }
        else
        {
            gazeTimer = 0f;
        }
    }

    private void ReturnToLobby()
    {
        LobbyManager.Instance?.ReturnToLobby();
    }
}
```

- [ ] **Step 2: Commit**

```bash
cd C:\projects\spaces-vr
git add Assets/Scripts/Interaction/PalmMenu.cs
git commit -m "feat: add palm menu with gaze-confirm return to lobby"
```

---

### Task 9: Scene Setup and Prefab Assembly (Unity Editor)

**Context:** This task is done entirely in the Unity Editor. It connects all the scripts to GameObjects and creates the prefabs and scenes.

- [ ] **Step 1: Create PaneSurface prefab**

1. In Scene, create: 3D Object → Quad. Name it `PaneSurface`.
2. Scale: (1.2, 0.8, 1). This is the pane surface.
3. Create a dark material (`PaneSurface.mat`): Shader = URP/Lit, Base Color = `#0a0a0f`, Metallic = 0, Smoothness = 0.1.
4. Add a child: 3D Object → Sphere (scale 0.02) for the status dot. Position top-left corner.
5. Add child TextMeshPro objects for header (top of quad) and content (body).
6. Add components to the root:
   - `PaneSurface.cs`
   - `GazeFocusHighlight.cs`
   - `BoxCollider` (auto-added by PaneSurface RequireComponent)
7. Wire serialized fields: `contentText`, `header`, `statusIndicator` → child objects.
8. Drag to `Assets/Prefabs/PaneSurface.prefab`.

- [ ] **Step 2: Create WorkspaceDoor prefab**

1. Create an empty GameObject named `WorkspaceDoor`.
2. Add child: Cube scaled to (1.2, 2.2, 0.1) — the door frame. Apply `DoorFrame.mat`.
3. Add child: TextMeshPro for name label (above frame).
4. Add child: TextMeshPro for info label (inside frame).
5. Add child: Point Light (range 2, intensity 0.5) for glow.
6. Add components to root:
   - `WorkspaceDoor.cs`
   - `DoorInteraction.cs`
   - `GazeFocusHighlight.cs`
   - `BoxCollider` (size matching the door frame)
7. Wire serialized fields.
8. Drag to `Assets/Prefabs/WorkspaceDoor.prefab`.

- [ ] **Step 3: Set up the main scene**

1. Open the default scene (or create `Assets/Scenes/Main.unity`).
2. Ensure OVRCameraRig is present (from Task 1).
3. Create empty GameObjects:
   - `[Managers]` — add `SessionManager.cs`, `SpacesConnection.cs`, `GazeManager.cs`
   - `[Lobby]` — add `LobbyManager.cs`. Wire `doorPrefab` to the WorkspaceDoor prefab.
   - `[Room]` — add `RoomManager.cs`. Wire `panePrefab` to the PaneSurface prefab. Add a Directional Light child for room lighting.
   - `[Interaction]` — add `HandGrabHandler.cs`. Wire `leftHand` and `rightHand` to OVRHandPrefab instances.
   - `[PalmMenu]` — add `PalmMenu.cs` with a small floating Canvas child for the home button.
4. Add OVRHandPrefab for left and right hands (from Meta XR SDK samples).
5. Set Room container initially inactive.
6. Create an "Offline Panel" — a TextMeshPro world-space canvas at center, initially inactive. Wire to LobbyManager's `offlinePanel` field.
7. Wire cross-references: LobbyManager.roomManager → RoomManager, etc.

- [ ] **Step 4: Test in editor Play Mode**

Press Play in Unity Editor. With Meta XR Simulator:
1. Verify lobby spawns — should see "Offline" panel if no server is running.
2. Start Spaces server (`node bin/spaces.js --port 3457`). Hit Play again.
3. Doors should appear for each workspace.
4. Simulated gaze → door → should trigger confirm ring and enter room.
5. Panes should spawn in semicircle with correct names.

- [ ] **Step 5: Commit**

```bash
cd C:\projects\spaces-vr
git add -A
git commit -m "feat: assemble scenes, prefabs, and wire all components"
```

---

### Task 10: Quest 3 Build and Deploy

- [ ] **Step 1: Configure Android build**

In Unity:
1. File → Build Settings → ensure Android platform is selected
2. Player Settings → verify: IL2CPP, ARM64, Vulkan, API 32 (from Task 1)
3. XR Plug-in Management → verify Oculus checked
4. Meta XR → verify Eye Tracking + Hand Tracking enabled

- [ ] **Step 2: Build APK**

File → Build Settings → Build → save as `Build/SpacesVR.apk`

Expected: Build succeeds. First build takes 5-10 minutes.

- [ ] **Step 3: Deploy to Quest 3 (when you have one)**

Option A — Quest Link:
1. Connect Quest via USB-C or Air Link
2. In Unity: File → Build and Run (deploys and launches automatically)

Option B — SideQuest:
1. Install SideQuest on PC
2. Connect Quest via USB
3. Drag `Build/SpacesVR.apk` into SideQuest
4. On Quest: Unknown Sources → Spaces VR

- [ ] **Step 4: Commit final build config**

```bash
cd C:\projects\spaces-vr
git add -A
git commit -m "chore: finalize Quest 3 build configuration"
```

---

### Summary: File Map

```
C:\projects\spaces-vr\Assets\Scripts\
├── Core\
│   ├── WorkspaceData.cs        # Task 2 — data models + JSON helpers
│   ├── SpacesConnection.cs     # Task 2 — HTTP client + polling
│   └── SessionManager.cs       # Task 2 — auth token management
├── Interaction\
│   ├── GazeManager.cs          # Task 3 — eye tracking + head-gaze fallback
│   ├── GazeFocusHighlight.cs   # Task 3 — visual focus feedback
│   ├── HandGrabHandler.cs      # Task 5 — grab/move/resize
│   └── PalmMenu.cs             # Task 8 — palm-up home button
├── Lobby\
│   ├── LobbyManager.cs         # Task 6 — spawn doors, manage transitions
│   ├── WorkspaceDoor.cs        # Task 6 — door rendering
│   └── DoorInteraction.cs      # Task 6 — gaze-to-enter
├── Room\
│   ├── RoomManager.cs          # Task 7 — spawn panes, room lighting
│   ├── PaneSurface.cs          # Task 4 — pane placeholder
│   └── PaneLayout.cs           # Task 4 — semicircle math
└── UI\
    ├── PaneHeader.cs           # Task 4 — agent name/type label
    └── StatusIndicator.cs      # Task 4 — colored status dot

C:\projects\spaces\src\app\api\panes\route.ts  # Task 0 — workspace_id filter
```
