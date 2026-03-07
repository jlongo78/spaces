# Design: `spaces service` subcommand

**Date:** 2026-03-07

## Purpose

Allow customers to install Spaces as a persistent system service so it starts automatically on boot/login without manual intervention.

## CLI Interface

```
spaces service install     # prompts: system or user level
spaces service uninstall   # stops, disables, removes service config
spaces service start       # starts via service manager
spaces service stop        # stops via service manager
spaces service status      # shows running state
spaces service logs        # tails service logs
```

## Config Capture

`install` reads the current resolved config (port, tier, base-path, allowed-origins) from `~/.spaces/server.json` and bakes them into the service definition as environment variables. Also captures:

- `process.execPath` — exact node binary (handles nvm/fnm)
- Resolved path to `bin/spaces.js`

Running `install` again overwrites the existing definition and restarts — idempotent, safe to re-run after config changes.

## Install Prompt

```
  Install as:
    1. System service (starts on boot, runs as root)
    2. User service (starts on login, runs as your user)
  Choice [2]:
```

Default is user-level (most customers won't have root/admin).

## Platform: Linux (systemd)

**User service:** `~/.config/systemd/user/spaces.service`, managed with `systemctl --user`.

**System service:** `/etc/systemd/system/spaces.service`, managed with `systemctl`. Runs as the installing user (`User=`/`Group=` directives). Re-execs with `sudo` if needed.

Unit file template (user-level):

```ini
[Unit]
Description=Spaces - Agent Workspace Manager
After=network.target

[Service]
Type=simple
ExecStart=/path/to/node /path/to/spaces.js
WorkingDirectory=/path/to/spaces/project
Environment=SPACES_PORT=3457
Environment=SPACES_TIER=community
Environment=SPACES_BASE_PATH=
Environment=SPACES_ALLOWED_ORIGINS=
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

System-level uses `multi-user.target` and adds `User=`/`Group=`.

After writing, `install` runs `daemon-reload`, `enable`, and `start`.

**Logs:** `journalctl --user -u spaces -f` (user) or `journalctl -u spaces -f` (system).

## Platform: macOS (launchd)

**User service:** `~/Library/LaunchAgents/com.agentspaces.spaces.plist`

**System service:** `/Library/LaunchDaemons/com.agentspaces.spaces.plist` (requires sudo, uses `UserName` key).

Plist template:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agentspaces.spaces</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/node</string>
        <string>/path/to/spaces.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/spaces/project</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>SPACES_PORT</key><string>3457</string>
        <key>SPACES_TIER</key><string>community</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key>
    <string>/path/to/.spaces/logs/spaces.out.log</string>
    <key>StandardErrorPath</key>
    <string>/path/to/.spaces/logs/spaces.err.log</string>
</dict>
</plist>
```

**Logs:** `tail -f ~/.spaces/logs/spaces.out.log`

`install` runs `launchctl load -w` / `launchctl bootstrap`. `uninstall` runs `launchctl unload` then deletes the plist.

## Platform: Windows (Task Scheduler)

Both user and system level use Task Scheduler (avoids needing `node-windows` or similar deps).

**User service:** `schtasks /Create /TN "Spaces" /TR "..." /SC ONLOGON /RL HIGHEST`

**System service:** `schtasks /Create /TN "Spaces" /TR "..." /SC ONSTART /RU SYSTEM`

**Logs:** Output redirected to `%USERPROFILE%\.spaces\logs\spaces.out.log`.

## Implementation

Single file: `bin/spaces-service.js`. Detects platform via `process.platform` and dispatches to platform-specific functions. Each platform's install/uninstall is ~40-60 lines — small enough for one file.

Routing in `bin/spaces.js` follows the same pattern as `spaces install`:

```js
if (subcommand === 'service') {
  const serviceScript = path.join(__dirname, 'spaces-service.js');
  const { status } = spawnSync(process.execPath, [serviceScript, ...args.slice(1)], {
    stdio: 'inherit', env: process.env
  });
  process.exit(status || 0);
}
```

## What's NOT in scope

- No dependency on `node-windows`, `node-mac`, or `node-linux`
- `uninstall` does not touch `~/.spaces/` data — only removes the service config
- No Docker/container support (services don't make sense inside containers)
