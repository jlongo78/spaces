# `spaces service` Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `spaces service` subcommand that installs/manages Spaces as a persistent OS service on Linux (systemd), macOS (launchd), and Windows (Task Scheduler).

**Architecture:** Single file `bin/spaces-service.js` dispatched from `bin/spaces.js`. Platform detection via `process.platform` routes to platform-specific install/uninstall/start/stop/status/logs functions. Config is read from `~/.spaces/server.json` and baked into service definitions.

**Tech Stack:** Node.js (no new dependencies). Uses `child_process.execFileSync`/`spawnSync` for service manager commands. `readline` for interactive prompt.

**Design doc:** `docs/plans/2026-03-07-service-command-design.md`

---

### Task 1: Route `service` subcommand in `bin/spaces.js`

**Files:**
- Modify: `bin/spaces.js:29-46` (help text)
- Modify: `bin/spaces.js:56-65` (subcommand routing)

**Step 1: Add service to help text**

In `bin/spaces.js`, find the help text block and add the service commands. Change:

```js
    spaces --help                Show this help
```

to:

```js
    spaces service install       Install as OS service (systemd/launchd/Task Scheduler)
    spaces service uninstall     Remove OS service
    spaces service start         Start the service
    spaces service stop          Stop the service
    spaces service status        Show service status
    spaces service logs          Tail service logs
    spaces --help                Show this help
```

**Step 2: Add routing for `service` subcommand**

In `bin/spaces.js`, after the install/uninstall/verify/upgrade routing block (line 57-65), add a new block before the setup wizard section:

```js
// ─── Route service commands to spaces-service.js ─────
if (subcommand === 'service') {
  const serviceScript = path.join(__dirname, 'spaces-service.js');
  const { status } = require('child_process').spawnSync(
    process.execPath, [serviceScript, ...args.slice(1)],
    { stdio: 'inherit', env: process.env }
  );
  process.exit(status || 0);
}
```

**Step 3: Verify routing works**

Run: `node bin/spaces.js --help`
Expected: Service commands appear in help output.

Run: `node bin/spaces.js service`
Expected: Error about missing `spaces-service.js` (we haven't created it yet) or "Unknown command" -- confirms routing is wired.

**Step 4: Commit**

```bash
git add bin/spaces.js
git commit -m "Add service subcommand routing and help text"
```

---

### Task 2: Create `bin/spaces-service.js` -- scaffolding, config capture, and prompt

**Files:**
- Create: `bin/spaces-service.js`

**Step 1: Create the file with shared helpers and CLI dispatch**

Create `bin/spaces-service.js` with:
- Shared constants: `SPACES_DIR`, `CONFIG_PATH`, `LOGS_DIR`, `SERVICE_NAME` (`spaces`), `LABEL` (`com.agentspaces.spaces`), `TASK_NAME` (`Spaces`)
- Helper functions: `log()`, `logOk()`, `logErr()` (same pattern as spaces-install.js)
- `resolveConfig()` -- reads `~/.spaces/server.json`, returns `{ port, tier, basePath, allowedOrigins }` with defaults
- `resolveSpacesPath()` -- returns `path.join(__dirname, 'spaces.js')`
- `resolveProjectDir()` -- returns `path.join(__dirname, '..')`
- `resolveNodePath()` -- returns `process.execPath`
- `promptLevel()` -- uses readline to ask system vs user, defaults to user (choice 2)
- `ensureLogsDir()` -- creates `~/.spaces/logs/` via `fs.mkdirSync` with recursive
- `LEVEL_PATH` (`~/.spaces/service-level`) -- tracks installed level so start/stop/status/logs know which to target
- `saveLevel(level)` and `loadLevel()` -- write/read the level file
- `getPlatform()` -- returns `linux`/`darwin`/`win32` or exits with error
- Dispatch table mapping platform to `{ install, uninstall, start, stop, status, logs }` functions
- `main()` async function that reads `process.argv[2]` as action, dispatches to platform function
- Stub function declarations for all 18 platform functions (will be filled in Tasks 3-5)

**Step 2: Verify scaffolding runs**

Run: `node bin/spaces-service.js`
Expected: Prints usage message and exits cleanly.

**Step 3: Commit**

```bash
git add bin/spaces-service.js
git commit -m "Add spaces-service.js scaffolding with config capture and prompt"
```

---

### Task 3: Implement Linux (systemd) functions

**Files:**
- Modify: `bin/spaces-service.js` (fill in Linux stubs)

**Step 1: Implement all Linux functions**

- `linuxServicePath(level)` -- returns `/etc/systemd/system/spaces.service` for system, `~/.config/systemd/user/spaces.service` for user (creates dir with `mkdirSync` recursive)
- `linuxUnitFile(level)` -- generates systemd unit file string:
  - `[Unit]` with `Description` and `After=network.target`
  - `[Service]` with `Type=simple`, `ExecStart` (node + spaces.js), `WorkingDirectory`, `Environment` lines for port/tier/basePath/allowedOrigins, `Restart=on-failure`, `RestartSec=5`
  - System level adds `User=` and `Group=` from `os.userInfo().username`
  - `[Install]` with `WantedBy=multi-user.target` (system) or `default.target` (user)
- `linuxSystemctl(level, ...args)` -- runs `sudo systemctl ...args` for system, `systemctl --user ...args` for user, via `execFileSync` with `stdio: 'inherit'`
- `linuxInstall()` -- prompts level, writes unit file (via `sudo tee` for system, `fs.writeFileSync` for user), saves level, runs daemon-reload + enable + start. For user level, also runs `loginctl enable-linger` so service survives logout.
- `linuxUninstall()` -- loads saved level, stops + disables + removes unit file + daemon-reload + removes level file
- `linuxStart()` / `linuxStop()` -- loads level, runs systemctl start/stop
- `linuxStatus()` -- loads level, runs systemctl status (catches non-zero exit from stopped services)
- `linuxLogs()` -- loads level, runs `journalctl -u spaces -f --no-pager` (with `--user` for user level, `sudo` for system level) via `spawnSync` with `stdio: 'inherit'`

All service manager calls use `execFileSync` (not `exec`) to prevent shell injection.

**Step 2: Test on this Linux machine**

Run: `node bin/spaces-service.js install` (choose user)
Then: `node bin/spaces-service.js status`
Then: `node bin/spaces-service.js uninstall`

**Step 3: Commit**

```bash
git add bin/spaces-service.js
git commit -m "Implement Linux systemd service management"
```

---

### Task 4: Implement macOS (launchd) functions

**Files:**
- Modify: `bin/spaces-service.js` (fill in macOS stubs)

**Step 1: Implement all macOS functions**

- `darwinPlistPath(level)` -- returns `/Library/LaunchDaemons/com.agentspaces.spaces.plist` for system, `~/Library/LaunchAgents/com.agentspaces.spaces.plist` for user
- `darwinPlistContent(level)` -- generates XML plist string with:
  - `Label`: `com.agentspaces.spaces`
  - `ProgramArguments`: array with node path and spaces.js path
  - `WorkingDirectory`: project dir
  - `EnvironmentVariables`: dict with port, tier, basePath (if set), allowedOrigins (if set)
  - `RunAtLoad`: true, `KeepAlive`: true
  - `StandardOutPath` / `StandardErrorPath`: `~/.spaces/logs/spaces.out.log` and `.err.log`
  - System level adds `UserName` key
- `darwinInstall()` -- prompts level, unloads existing if present, writes plist (via `sudo tee` + `chown root:wheel` + `chmod 644` for system, `fs.writeFileSync` for user), saves level, loads with `launchctl load -w`
- `darwinUninstall()` -- loads level, runs `launchctl unload -w`, deletes plist file, removes level file
- `darwinStart()` / `darwinStop()` -- loads level, runs `launchctl load -w` / `launchctl unload -w`
- `darwinStatus()` -- runs `launchctl list`, filters output for the label
- `darwinLogs()` -- runs `tail -f ~/.spaces/logs/spaces.out.log` via `spawnSync`

**Step 2: Commit**

```bash
git add bin/spaces-service.js
git commit -m "Implement macOS launchd service management"
```

---

### Task 5: Implement Windows (Task Scheduler) functions

**Files:**
- Modify: `bin/spaces-service.js` (fill in Windows stubs)

**Step 1: Implement all Windows functions**

- `win32WrapperScript()` -- writes a `.cmd` file to `~/.spaces/spaces-service.cmd` that sets environment variables and runs `node spaces.js` with stdout/stderr redirected to log files. Returns the wrapper path. This is needed because `schtasks /TR` doesn't handle multi-arg commands or env vars well.
- `win32Install()` -- prompts level, generates wrapper script, deletes existing task (`schtasks /Delete /TN Spaces /F`), creates task with `/SC ONLOGON /RL HIGHEST` (user) or `/SC ONSTART /RU SYSTEM` (system), saves level, starts immediately with `/Run`
- `win32Uninstall()` -- ends task (`/End`), deletes task (`/Delete /F`), removes wrapper script and level file
- `win32Start()` / `win32Stop()` -- runs `schtasks /Run` / `schtasks /End`
- `win32Status()` -- runs `schtasks /Query /TN Spaces /V /FO LIST`
- `win32Logs()` -- runs `powershell -Command "Get-Content path -Wait -Tail 50"` via `spawnSync`

All `schtasks` calls use `execFileSync` with array args (no shell).

**Step 2: Commit**

```bash
git add bin/spaces-service.js
git commit -m "Implement Windows Task Scheduler service management"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `docs/server-install.md`

**Step 1: Add "Running as a Service" section**

After the "CLI Reference" section (~line 295), add a new section covering:
- `spaces service install` with explanation of the system/user prompt
- Table of all service subcommands (status, stop, start, logs, uninstall)
- Note about re-running install after config changes
- Platform details table (Linux/macOS/Windows with paths for user and system level)
- Logs info (journalctl for Linux, file-based for macOS/Windows)

**Step 2: Update CLI Reference**

Add `spaces service <action>` line to the existing CLI Reference block.

**Step 3: Commit**

```bash
git add docs/server-install.md
git commit -m "Add service management docs to server-install.md"
```

---

### Task 7: End-to-end test on Linux

**Step 1: Test full lifecycle**

```bash
node bin/spaces.js service install    # choose user
node bin/spaces.js service status     # should show active
node bin/spaces.js service logs       # Ctrl+C after seeing output
node bin/spaces.js service stop       # should stop
node bin/spaces.js service status     # should show inactive
node bin/spaces.js service start      # should restart
node bin/spaces.js service uninstall  # should clean up
```

**Step 2: Verify cleanup**

Confirm no leftover files at `~/.config/systemd/user/spaces.service` or `~/.spaces/service-level`.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "Fix issues found during service e2e testing"
```
