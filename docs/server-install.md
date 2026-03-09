# Spaces Installation Guide

## Tier Overview

| Tier | Packages | Features |
|------|----------|----------|
| `community` | `@jlongo78/agent-spaces` | Single user, no auth, local terminals |
| `team` | + `@spaces/teams` | Auth, multi-user, admin panel, collaboration (message bus, hooks, MCP tools, ActivityPanel) |
| `federation` | + `@spaces/pro` | All team features + mDNS network discovery, remote nodes |

Each tier builds on the previous. Federation requires both `@spaces/teams` and `@spaces/pro`.

---

## Prerequisites

- Node.js 20+ and npm
- Git (to clone private repos)
- GitHub access to `jlongo78` repos (for teams and pro packages)

---

## Uninstall (clean slate)

If Spaces is already installed and you want to start fresh:

**1. Stop the server** — press `Ctrl+C` in the terminal where Spaces is running. If you can't find it:

```bash
# Linux/macOS
lsof -t -i:3457 | xargs kill

# Windows
netstat -ano | findstr :3457
taskkill /F /PID <pid>
```

**2. Uninstall packages:**

```bash
npm uninstall -g @jlongo78/agent-spaces @spaces/teams @spaces/pro
```

Windows: if you get `EBUSY`, make sure the server is fully stopped first. Kill all `node.exe` processes if needed.

**3. Remove config and data:**

```bash
# Linux/macOS
rm -rf ~/.spaces/

# Windows
rmdir /S /Q "%USERPROFILE%\.spaces"
```

**4. Verify clean:**

```bash
which spaces            # Should return nothing
npm ls -g --depth=0     # Should not list any spaces packages
```

---

## 1. Community Edition

### Install

```bash
npm install -g @jlongo78/agent-spaces
spaces
```

Opens `http://localhost:3457`. No login, no setup required.

### Verify

- Terminal page loads, you can create panes and workspaces
- No "Collab" button in workspace header
- No login screen
- Tier check:
  ```bash
  curl -s http://localhost:3457/api/tier/
  # {"tier":"community","hasAuth":false,"hasCollaboration":false,"hasNetwork":false,...}
  ```
- Collaboration APIs are stubbed:
  ```bash
  curl -s http://localhost:3457/api/workspaces/1/messages/
  # {"error":"Requires @spaces/teams"}
  ```

---

## 2. Team Edition

Stop the running server (`Ctrl+C`) before installing.

### Install @spaces/teams

`@spaces/teams` is a private package — it's not on the public npm registry. Install from GitHub:

```bash
npm install -g github:jlongo78/spaces-teams
```

This is plain JavaScript — no build step needed.

### Verify package is discoverable

```bash
node -e "console.log(require.resolve('@spaces/teams'))"
# Should print the path to @spaces/teams/index.js
```

### Start

```bash
spaces
```

On first run, auto-setup creates:
- `~/.spaces/session_secret` — session signing key
- `~/.spaces/admin.db` — user database with admin credentials
- Prints the generated username and password — **save these**

### Verify

1. **Tier:**
   ```bash
   curl -s http://localhost:3457/api/tier/
   # {"tier":"team","hasAuth":true,"hasCollaboration":true,"hasNetwork":false,...}
   ```

2. **Login screen appears** — use the credentials from setup

3. **Collab button visible** in workspace header

4. **Messages API works** (requires auth cookie — test in browser devtools or with session cookie):
   ```bash
   curl -s http://localhost:3457/api/workspaces/1/messages/
   # Returns array (not "Requires @spaces/teams" error)
   ```

5. **ActivityPanel** renders when collaboration is enabled on a workspace

6. **Database tables created:**
   ```bash
   sqlite3 ~/.spaces/spaces.db ".tables"
   # Should include workspace_messages and workspace_context
   ```

---

## 3. Federation Edition

Stop the running server (`Ctrl+C`) before installing.

### Install @spaces/pro

`@spaces/pro` is also private. Install from GitHub:

```bash
npm install -g github:jlongo78/spaces-pro
```

Note: `@spaces/pro` is TypeScript and ships pre-built. If installing from source instead, you must `npm run build` first.

### Verify both packages

```bash
node -e "console.log(require.resolve('@spaces/teams'))"
node -e "console.log(require.resolve('@spaces/pro'))"
# Both should print paths
```

### Start

```bash
spaces
```

### Verify

1. **Tier:**
   ```bash
   curl -s http://localhost:3457/api/tier/
   # {"tier":"federation","hasAuth":true,"hasCollaboration":true,"hasNetwork":true,...}
   ```

2. **All team features still work**

3. **mDNS discovery** — server log shows `[mDNS] Advertising as "..." on port 3458`

4. **Network features** — remote nodes appear in sidebar/settings when other federation instances are on the network

---

## Reverse Proxy Setup

When serving behind a reverse proxy (e.g., Traefik, nginx) at a subpath like `/spaces/`:

### Configure base path

```bash
spaces --base-path /spaces
```

Or set in `~/.spaces/server.json`:
```json
{"basePath": "/spaces", "port": 3457}
```

### Configure allowed origins

For non-community tiers, WebSocket connections from external origins are blocked by default. You must whitelist your domain:

```bash
SPACES_ALLOWED_ORIGINS=yourdomain.com spaces
```

Multiple origins:
```bash
SPACES_ALLOWED_ORIGINS=yourdomain.com,other.example.com spaces
```

**Without this, terminals will not connect** when accessed through the reverse proxy. Localhost connections always work.

### Traefik example

```yaml
http:
  routers:
    spaces:
      rule: "PathPrefix(`/spaces`)"
      service: spaces
      entryPoints: [websecure]
      tls: {}

  services:
    spaces:
      loadBalancer:
        servers:
          - url: "http://localhost:3457"
```

No path stripping needed — Spaces handles the base path internally.

---

## Tier Detection Logic

The launcher resolves the tier at startup:

1. `--tier` CLI flag (highest priority)
2. `SPACES_TIER` environment variable
3. `~/.spaces/server.json` → `tier` field
4. **Auto-detect** (lowest priority):
   - `@spaces/pro` found → `federation`
   - `@spaces/teams` found (no pro) → `team`
   - Neither found → `community`

One build, any tier — features activate at runtime based on which packages are installed.

---

## Configuration

All config lives under `~/.spaces/`:

| File | Purpose | Created by |
|------|---------|------------|
| `server.json` | tier, port, basePath | `spaces --setup` or auto-setup |
| `session_secret` | HMAC secret for session tokens | auto-setup (first non-community run) |
| `admin.db` | User database (SQLite) | auto-setup |
| `spaces.db` | Application data (per-user workspaces, panes) | first request |
| `service_key` / `service_key.pub` | SSH keypair for system service multi-user terminals | system service first start |
| `known_hosts` | SSH known hosts for localhost connections | first SSH terminal spawn |
| `service-level` | Tracks whether service is user or system level | `spaces service install` |
| `spaces-service.cmd` | Windows service wrapper script | `spaces service install` (Windows) |
| `logs/spaces.out.log` | Service stdout/stderr log | service start (macOS/Windows) |

### Reset auth but keep data

```bash
rm ~/.spaces/server.json ~/.spaces/session_secret ~/.spaces/admin.db
spaces    # Re-runs auto-setup, generates new credentials
```

---

## CLI Reference

```
spaces                        Start the server (auto-detects tier)
spaces --setup                Interactive first-time setup wizard
spaces --port 3457            Override port
spaces --tier team            Override tier (community|team|federation)
spaces --base-path /spaces    Set base path for reverse proxy
spaces --help                 Show help
spaces service <action>           Manage OS service (install|uninstall|start|stop|status|logs)
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SPACES_TIER` | Override tier detection | auto-detect |
| `SPACES_PORT` | Server port | `3457` |
| `SPACES_BASE_PATH` | Base path for subpath deployments | (none) |
| `SPACES_SESSION_SECRET` | Session signing secret | from `~/.spaces/session_secret` |
| `SPACES_ALLOWED_ORIGINS` | Comma-separated hostnames for WebSocket origin check | localhost only |

---

## Running as a Service

Install Spaces as a persistent OS service that starts automatically:

```bash
spaces service install
```

You'll be prompted to choose system-level (starts on boot) or user-level (starts on login).

The installer captures your current config from `~/.spaces/server.json` and bakes it into the service definition. If you change config later, re-run `spaces service install` to update.

### Service commands

| Command | Description |
|---------|-------------|
| `spaces service install` | Install and start the service |
| `spaces service uninstall` | Stop and remove the service |
| `spaces service start` | Start the service |
| `spaces service stop` | Stop the service |
| `spaces service status` | Show service status |
| `spaces service logs` | Tail service logs |

### System vs. User service

| Level | When it runs | Process identity | Best for |
|-------|-------------|-----------------|----------|
| **User** | On login | Your user account | Personal machines, single user |
| **System** | On boot | SYSTEM (Windows) / root (Linux) | Shared machines, always-on servers |

**User-level** is simpler — processes run as you, no permission issues.

**System-level** runs as a different OS account. On Windows this means the SYSTEM account, which requires special handling for file access, home directories, and terminal spawning (see below).

### Platform details

| Platform | User-level location | System-level location |
|----------|--------------------|-----------------------|
| Linux | `~/.config/systemd/user/spaces.service` | `/etc/systemd/system/spaces.service` (sudo) |
| macOS | `~/Library/LaunchAgents/com.agentspaces.spaces.plist` | `/Library/LaunchDaemons/com.agentspaces.spaces.plist` (sudo) |
| Windows | Scheduled Task (ONLOGON) | Scheduled Task (ONSTART, SYSTEM) |

### Logs

- **Linux:** `spaces service logs` uses journalctl (integrated with systemd)
- **macOS / Windows:** Log files at `~/.spaces/logs/spaces.out.log`, view with `spaces service logs`

---

## Windows System Service (Detailed)

Running Spaces as a Windows system service has additional complexity because the service runs under the `NT AUTHORITY\SYSTEM` account, which has no user profile, no home directory, and can't directly interact with user sessions.

### Prerequisites

- **Administrator access** — service install/uninstall/start/stop require an elevated terminal
- **Node.js 20+** installed and on PATH
- **OpenSSH Server** — installed automatically during system service setup, or manually:
  ```powershell
  # In an elevated PowerShell:
  Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
  Start-Service sshd
  Set-Service -Name sshd -StartupType Automatic
  ```

### Install

From an **Administrator** terminal:

```bash
spaces service install
```

Choose **1** for system service. The installer will:

1. **Detect target user** — scans `C:\Users\*` for profiles with Claude Code data (`.claude/` directory). If multiple users are found, you'll be asked which one to target.
2. **Create wrapper script** — `~/.spaces/spaces-service.cmd` with environment overrides:
   - `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH` — set to the target user's home so `os.homedir()` resolves correctly under SYSTEM
   - `SPACES_SERVICE=1` — prevents browser auto-open and enables service mode behaviors
3. **Create scheduled task** — `Spaces` task under Task Scheduler, runs as SYSTEM on boot
4. **Ensure OpenSSH Server** — installs and starts sshd if not present
5. **Start the service** — launches the task immediately

On first start, the SYSTEM process will:
- Run auto-setup if needed (creates admin DB with the target user's username as shell_user)
- Generate an SSH service key owned by SYSTEM at `~/.spaces/service_key`
- Authorize the key in `C:\ProgramData\ssh\administrators_authorized_keys` (for admin users) and in each user's `~/.ssh/authorized_keys` (for non-admin users)

### How terminals work under SYSTEM

Since the service runs as SYSTEM but terminals need to run as the actual user:

1. **Auth resolution** — When a terminal request arrives, the service maps SYSTEM → the first admin DB user
2. **Shell user lookup** — The app username is mapped to an OS shell user via the admin database
3. **SSH to localhost** — The service spawns `ssh -4 -i ~/.spaces/service_key <user>@localhost` to get a shell as the correct user
4. **Directory change** — After SSH connects, the service sends `cd /d "C:\path\to\project"` to navigate to the workspace directory

This requires OpenSSH Server running and the service key authorized for the target user.

### Upgrading tiers with a system service

If you install `@spaces/pro` or `@spaces/teams` after the service is already running:

```bash
spaces service stop
spaces install pro        # or: npm install -g @spaces/pro
spaces service start
```

The tier is auto-detected from installed packages at startup — no service reinstall needed.

### Task Scheduler notes

- The scheduled task is named **Spaces** and runs under `NT AUTHORITY\SYSTEM`
- **Battery mode** — Task Scheduler may stop the task on battery power. To prevent this:
  ```powershell
  # In elevated PowerShell:
  $task = Get-ScheduledTask -TaskName "Spaces"
  $task.Settings.DisallowStartIfOnBatteries = $false
  $task.Settings.StopIfGoingOnBatteries = $false
  Set-ScheduledTask $task
  ```
- The wrapper script redirects all output to `~/.spaces/logs/spaces.out.log`

### Verifying the system service

```bash
# Check service status
spaces service status

# Check logs
spaces service logs

# Verify SSH key setup
dir "%USERPROFILE%\.spaces\service_key"
dir "%USERPROFILE%\.spaces\service_key.pub"

# Test SSH (from the target user's terminal)
ssh -i "%USERPROFILE%\.spaces\service_key" -o BatchMode=yes localhost "echo works"

# Check what's listening
netstat -ano | findstr :3457
```

---

## Troubleshooting

### Terminals don't connect (WebSocket fails silently)

Most common cause: **missing `SPACES_ALLOWED_ORIGINS`**. When running behind a reverse proxy on a non-community tier, the server rejects WebSocket upgrades from non-localhost origins. Set:

```bash
SPACES_ALLOWED_ORIGINS=yourdomain.com spaces
```

### Tier shows "community" despite packages installed

The launcher detects packages at startup. If you installed packages while the server was running, **restart the server**.

Verify packages are globally resolvable:
```bash
node -e "console.log(require.resolve('@spaces/teams'))"
node -e "console.log(require.resolve('@spaces/pro'))"
```

If these fail:
- Check `npm prefix -g` points to the right place
- nvm users: make sure you're using the same Node version you installed with

### Windows: EBUSY on uninstall

Something is holding a lock on the files — usually a running Spaces server. Stop it first:
```cmd
taskkill /F /IM node.exe
npm uninstall -g @jlongo78/agent-spaces @spaces/teams @spaces/pro
```

### npm install from GitHub fails with native module errors

`@jlongo78/agent-spaces` (the main package) has native dependencies (better-sqlite3, node-pty) that need to be compiled. Install from npm (not GitHub) for the pre-built version:
```bash
npm install -g @jlongo78/agent-spaces    # pre-built, works everywhere
```

The add-on packages (`@spaces/teams`, `@spaces/pro`) are pure JS/pre-built and install from GitHub fine.

### Windows: Service freezes or can't connect

The server process is blocked. Common causes:
- **Browser auto-open in Session 0** — should not happen with `SPACES_SERVICE=1` but verify the wrapper script contains `set SPACES_SERVICE=1`
- **Port conflict** — check if another process is on port 3457: `netstat -ano | findstr :3457`
- **Battery mode** — Task Scheduler stops tasks on battery by default (see Task Scheduler notes above)

### Windows: Terminals show SYSTEM prompt or "claude not found"

The SSH setup didn't complete. Check:

1. **OpenSSH Server running:** `Get-Service sshd` should show Running
2. **Service key exists:** `dir %USERPROFILE%\.spaces\service_key`
3. **Key is authorized:**
   ```powershell
   # For admin users:
   type C:\ProgramData\ssh\administrators_authorized_keys
   # Should contain the public key from service_key.pub
   ```
4. **Key permissions:** The private key must only be readable by SYSTEM and the file owner. If you see "UNPROTECTED PRIVATE KEY FILE" errors in the log, fix with:
   ```powershell
   # In elevated PowerShell:
   icacls "$env:USERPROFILE\.spaces\service_key" /inheritance:r /remove "BUILTIN\Administrators" /remove "BUILTIN\Users" /remove "Everyone" /grant:r "NT AUTHORITY\SYSTEM:(F)"
   ```

### Windows: SSH "Connection reset by ::1 port 22"

The SSH client is connecting via IPv6 but sshd may not accept it. The service uses `-4` to force IPv4. If you see this error, ensure you're running the latest version of `terminal-server.js`.

### Windows: "spaces service stop" doesn't actually stop the server

The stop command needs admin privileges to kill SYSTEM processes. Run from an elevated terminal:
```bash
spaces service stop
```

If that still doesn't work:
```powershell
# In elevated PowerShell:
schtasks /End /TN Spaces
taskkill /F /IM node.exe    # Caution: kills ALL node processes
```

### Windows: Dashboard shows blank data / 0 projects

The SYSTEM account can't find the user's home directory. Verify the wrapper script at `~/.spaces/spaces-service.cmd` contains:
```
set USERPROFILE=C:\Users\YourUsername
set HOMEDRIVE=C:
set HOMEPATH=\Users\YourUsername
```

If not, reinstall the service: `spaces service uninstall && spaces service install`

### Agent panes don't get MCP server / hooks

- Ensure collaboration is enabled on the workspace (click "Collab" button)
- New agent panes auto-opt-in when workspace has collaboration on
- Check the pane's working directory for `.mcp.json` and `.claude/settings.local.json`

### "Requires @spaces/teams" on API calls

Expected on community tier. Install `@spaces/teams` and restart to enable collaboration APIs.
