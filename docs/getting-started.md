# Getting started

This walks through installing Spaces, running your first agents, reaching
them from a browser and from another machine, and keeping Spaces running in
the background.

## 1. Install

You need Node.js 20.9 or newer.

```bash
npm install -g @jlongo78/agent-spaces
```

On Linux the terminal library (`node-pty`) is compiled during install. If the
install fails with a `node-gyp` error, install a toolchain and try again:

```bash
sudo apt install build-essential python3      # Debian, Ubuntu
sudo dnf install gcc-c++ make python3         # Fedora, RHEL
```

macOS and Windows use prebuilt binaries and need nothing extra.

Spaces runs agents; it does not install them. Install whichever you use
(Claude Code, Codex CLI, Gemini CLI, Aider, ForgeCode, Pi) so that its
command is on your `PATH`. A pane can also be a plain shell or any command
you give it.

## 2. Start it

```bash
spaces
```

In a terminal this:

1. starts the Spaces server in the background on port 3457, if it is not
   already running (its log goes to `~/.spaces/server.log`);
2. opens the terminal client, signed in as you.

The server keeps running when the client exits. `spaces stop` stops it,
together with every pane.

On a platform without a prebuilt terminal client, `spaces` opens the web app
in your browser instead.

## 3. Your first space

Press `ctrl+k` (or click `menu` in the sidebar) to open the menu:

- **Create space**: type a name and press Enter.
- **New pane in &lt;space&gt;**: choose an agent, then a folder. For agents that
  can resume, Spaces offers that folder's past sessions.

The sidebar now shows the space and its agent. As the agent works, its marker
changes: `◐` working, `×` blocked (waiting for you), `✓` done, `○` idle.
When an agent in another pane blocks or finishes, a toast says so; click it
to go there.

Useful keys:

| Keys | Does |
| --- | --- |
| `ctrl+k` | The menu. |
| `ctrl+space d` | Detach. Agents keep running. |
| `ctrl+space s` | Show a second pane beside the first. |
| `ctrl+space f` | The space's Files tab. |
| `ctrl+space b` | Hide or show the sidebar. |
| `ctrl+space o` | Sort agents by space or by priority. |
| `ctrl+space m` | Let your terminal select text with the mouse. |

All other keys, `ctrl+c` included, go to the focused pane. The
[terminal client guide](../tui/README.md) covers the rest, including the
Files tab.

## 4. The web app

```bash
spaces web
```

This opens the web app in your default browser, already signed in. It shows
the same spaces and panes as the terminal client, live, and adds the session
browser, the dashboard, per-space todos and settings.

The server answers only its owner, so a browser has to sign in once.
`spaces web` does that with a link that works one time, for two minutes.
Opening `http://localhost:3457` in a browser that has not signed in shows a
"not signed in" page telling you to run `spaces web`. A browser stays signed
in for seven days.

If `spaces web` cannot launch a browser (on a machine without a desktop, for
instance) it prints the link instead.

### Choosing which folders Spaces can see

The web app's **Settings** page lists your *dev directories*. They are the
folders the file browsers (web and terminal) can open; when the list is
empty, your home folder is used. They are stored as `devDirectories` in
`~/.spaces/config.json`. Credential folders (`~/.spaces`, `~/.ssh`, `~/.aws`,
`~/.gnupg` and similar) are refused regardless.

## 5. Spaces on another machine

From your own machine:

```bash
spaces --remote you@devbox
```

Spaces connects with `ssh`, starts Spaces on `devbox` if it is not running,
opens a tunnel to it, and runs your local terminal client through the
tunnel. Anything `ssh` accepts works as the destination: `you@devbox`, a
`~/.ssh/config` alias, or `ssh://you@devbox:2222`.

If Spaces is not on that machine yet, or is older than yours, `--remote`
offers to install or update it first (`npm install -g` over the same SSH
login; Node.js 20.9 or newer must already be there). An update restarts the
remote server, which stops the agents running in it, so it says how many
would stop and lets you update, connect to the old version as it is, or
quit. `--yes` answers yes to all of it, for scripts.

If the other machine asks for a password, `--remote` offers to set up an
SSH key instead (each connection would otherwise ask again). It uses your
default key, or creates `~/.ssh/id_ed25519`, adds it to
`~/.ssh/authorized_keys` there with your password one last time, and checks
it works. A "no" is remembered for that machine.

For the web app instead of the terminal client:

```bash
spaces web --remote you@devbox
```

This does the same, then signs your browser in through the tunnel and opens
it at `http://127.0.0.1:<port>` (not `localhost`, so it never signs you out
of the Spaces on your own machine). The tunnel stays up until you press
Ctrl+C. The other machine needs Spaces 1.0.1 or newer, which `--remote`
offers to install.

Nothing new is exposed on `devbox`: its server stays on its own loopback,
and the only way in is your SSH login. The terminal client receives a
session token from `devbox`; the secret it is signed with never leaves
`devbox`.

The Files tab then browses `devbox`, and `d` downloads from it to your own
Downloads folder; `u`, or dragging files onto the tab, uploads to it.

When you detach, the remote server keeps running. To stop it:

```bash
ssh you@devbox spaces stop
```

## 6. Keep it running

To start Spaces automatically when you log in:

```bash
spaces service install      # choose "User service" when asked
spaces service status
spaces service logs
spaces service uninstall
```

This creates a systemd user unit on Linux (with lingering enabled so it
starts at boot), a launchd agent on macOS, or a Task Scheduler task on
Windows. The service runs `spaces` in the foreground without opening a
browser; use `spaces` or `spaces web` to reach it as usual. On Linux, put
any API keys the optional features need in `~/.spaces/env`
(`NAME=value`, one per line).

The installer also offers a *system service*. That option exists for the
experimental multiuser mode: it changes the SSH server's configuration and
installs an SSH key for the service. Don't choose it for a normal install.

`npm install -g` of a new version restarts an installed service
automatically.

## 7. Sign out everywhere

```bash
spaces signout
```

This replaces the secret every sign-in derives from, so every browser,
terminal client and remote session is signed out at once, and restarts a
running server so it uses the new secret. If Spaces runs as a service,
restart the service too: `spaces service stop && spaces service start`.

## Where Spaces keeps its data

By default Spaces keeps everything in `~/.spaces/`. To use another folder,
set `SPACES_HOME` to its path before you run `spaces`:

```bash
export SPACES_HOME=/data/spaces
spaces
```

A leading `~` means your home folder, and a relative path is taken from the
folder you run `spaces` in. The folder is created if it is missing. If the
path is an existing file, Spaces stops and says so. An empty value is the
same as not setting it. In multiuser mode, each user's data lives under
`$SPACES_HOME/users/<name>`.

To change it for a service, set `SPACES_HOME` and run
`spaces service install` again. The installer records the folder in the
service and prints `Data folder: ...`. System services, and installs for
another user, ignore `SPACES_HOME` and print a warning.

The file browsers in the web app and terminal client keep Spaces' own data
folder out of reach, so they hide your `SPACES_HOME` the same way.

This is also the fix if another application already uses `~/.spaces`.
Another macOS app named "Spaces" does. When Spaces finds a database it did
not create, it names the file and leaves it alone; set `SPACES_HOME` to a
different folder and Spaces starts with its own data there.

Spaces does not move existing data. To keep your spaces, copy the old
folder's contents into the new one first.

## Upgrading and removing

```bash
spaces upgrade      # install the latest version from npm
spaces uninstall    # remove the global package
```

Uninstalling leaves `~/.spaces/` in place. Delete it yourself to remove your
spaces, settings and the secret.

## Files Spaces uses

| Path | What |
| --- | --- |
| `~/.spaces/internal_token` | The owner's secret. Readable only by you. |
| `~/.spaces/spaces.db` | Spaces, panes, messages, todos, the session index. |
| `~/.spaces/config.json` | Settings from the web app, including `devDirectories`. |
| `~/.spaces/server.json` | Server settings: `port`, `basePath`, `allowedOrigins`, TLS files. |
| `~/.spaces/server.log` | Output of a server started in the background. |
| `~/.spaces/detection/` | Agent-detection rules: your overrides, and downloaded updates. |

Spaces also reads (never writes) agent history from `~/.claude/`,
`~/.codex/`, `~/.gemini/` and per-project Aider files.

## Troubleshooting

**`spaces` says the port is held by another account.** On Linux, Spaces
refuses to sign in to a server on its port that belongs to a different user.
Stop that process, or run on another port: `spaces --port 3460`.

**A browser shows "This sign-in link has expired or was already used."** The
link from `spaces web` works once, for two minutes. Run `spaces web`
again.

**The terminal client says multiuser mode is on.** The terminal client only
works with desktop mode. Set `"multiuser": false` in `~/.spaces/server.json`,
or run `spaces tui --desktop`.

**The server did not come up.** `spaces` prints the end of
`~/.spaces/server.log`; the full output is there.
