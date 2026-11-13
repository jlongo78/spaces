//! Boots the real Node runtime and drives it from Rust — the test that
//! proves the client and the server agree on the wire. `#[ignore]`d by
//! default so the fast suite stays hermetic; CI runs it explicitly (see
//! `.github/workflows/ci.yml`'s "integration test against the runtime"
//! step).
//!
//! # Isolated home directory
//!
//! A `boot()` that simply spawned `bin/spaces.js` with only `SPACES_PORT` and
//! `SPACES_NO_DETECTION_UPDATE` set would not be isolated. `getUserPaths`
//! (`src/lib/config.ts`) resolves `spacesDir` to `$SPACES_HOME` if set, else
//! `path.join(os.homedir(), '.spaces')`, and `snapshot()`
//! (`bin/lib/runtime/index.js`) reads its `panes`/`workspaces` arrays straight
//! out of `<spacesDir>/spaces.db` — so run unmodified, this test would boot
//! against a developer's real `~/.spaces/spaces.db`: `session.snapshot`'s
//! `panes` array would include every real pane row on that machine (not `live`,
//! but still present), a genuine `tui-itest` workspace would land in that
//! developer's live data, and `assert!(!ack.gap)` plus "the first event is
//! `workspace.created`" would both go flaky on any machine with existing
//! activity.
//!
//! Isolation therefore needs two things. `os.homedir()` honors `USERPROFILE`
//! on Windows and `HOME` on POSIX, so [`boot`] sets both on the child process
//! to a fresh per-test directory, and it also removes `SPACES_HOME` from the
//! child's environment so a developer's own value cannot override that home.
//! The directory is created under the OS temp dir and removed in [`Server`]'s
//! `Drop` alongside the kill. [`snapshot_and_events_agree_with_the_real_runtime`]
//! asserts the snapshot's `panes` array is empty on a freshly booted server
//! before trusting anything else the test observes — if isolation ever
//! silently stopped working, that assertion is what would catch it.
//!
//! # What actually gets booted
//!
//! `bin/spaces.js` refuses to start without a built `.next/standalone` or
//! `.next/BUILD_ID` ("No build found" — a fresh checkout has neither), so this
//! test boots `bin/terminal-server.js` instead. That file's own
//! `require.main === module` entry point only wires up the legacy `/ws`
//! endpoint, not `/proto` — `createTerminalServer` (the function that actually
//! mounts `/proto`) is exported but never called by that entry point.
//! `tests/support/boot_terminal_server.js` calls it directly, mounted on a bare
//! `http.Server`, the same way `bin/spaces.js`/`bin/spaces-dev.js` do, minus
//! the Next.js reverse proxy `/proto` never needed in the first place. See that
//! script's own doc comment for the rest (including why it also creates the
//! `spaces.db` schema by hand: nothing on this stripped-down path is the
//! Next.js API layer that would otherwise do it).

use std::process::{Child, Command, Stdio};

/// A fixed owner secret for the server this test boots in a temporary home.
const TEST_SECRET: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/// Boot the real Node runtime on an ephemeral port, isolated from the
/// developer's actual `~/.spaces` data. See the module docs.
struct Server {
    child: Child,
    port: u16,
    home_dir: std::path::PathBuf,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        // Best-effort: on Windows, a just-killed process can hold the
        // sqlite file open for a moment longer than `wait()` accounts for.
        // Leaking a per-test temp directory on the rare failure is far
        // better than this destructor panicking.
        let _ = std::fs::remove_dir_all(&self.home_dir);
    }
}

fn repo_root() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..")
}

async fn boot() -> Server {
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };

    let home_dir = std::env::temp_dir().join(format!(
        "spaces-tui-live-runtime-{}-{}",
        std::process::id(),
        port
    ));
    std::fs::create_dir_all(&home_dir).expect("create isolated home dir for the test runtime");

    let boot_script = repo_root()
        .join("tui")
        .join("crates")
        .join("spaces-tui")
        .join("tests")
        .join("support")
        .join("boot_terminal_server.js");
    let terminal_server = repo_root().join("bin").join("terminal-server.js");

    // Captured to files rather than inherited/nulled: if the poll loop below
    // times out, printing these is the difference between an actionable
    // failure and a bare "no build found"-shaped mystery.
    let stdout_path = home_dir.join("server.stdout.log");
    let stderr_path = home_dir.join("server.stderr.log");
    let stdout_file = std::fs::File::create(&stdout_path).expect("create server stdout log");
    let stderr_file = std::fs::File::create(&stderr_path).expect("create server stderr log");

    let child = Command::new("node")
        .arg(&boot_script)
        .arg(&terminal_server)
        .env("SPACES_PORT", port.to_string())
        .env("SPACES_NO_DETECTION_UPDATE", "1")
        // The owner's secret: the server answers only requests that prove
        // they hold it, and this test connects as the owner.
        .env("SPACES_INTERNAL_TOKEN", TEST_SECRET)
        // os.homedir() honors USERPROFILE on Windows, HOME on POSIX — set
        // both so this isolation holds on every platform CI runs it on.
        .env("HOME", &home_dir)
        .env("USERPROFILE", &home_dir)
        // A developer's own SPACES_HOME would override the home above and
        // point the server at their real data folder.
        .env_remove("SPACES_HOME")
        .current_dir(repo_root())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .expect("node must be on PATH");

    // Poll until the port answers.
    let mut up = false;
    for _ in 0..120 {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            up = true;
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }

    let server = Server {
        child,
        port,
        home_dir,
    };
    if !up {
        let stdout = std::fs::read_to_string(&stdout_path).unwrap_or_default();
        let stderr = std::fs::read_to_string(&stderr_path).unwrap_or_default();
        // `server` is already fully constructed, so the panic unwind below
        // still runs its `Drop` (kills the child, removes `home_dir`) even
        // though this function never returns it.
        panic!(
            "runtime never came up on 127.0.0.1:{port} within 30s\n--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}"
        );
    }
    server
}

#[tokio::test]
#[ignore = "boots the real node runtime; run with --ignored"]
async fn snapshot_and_events_agree_with_the_real_runtime() {
    let s = boot().await;
    let url = format!("ws://127.0.0.1:{}/proto", s.port);
    let mut c = spaces_proto::client::ControlClient::connect(&url, Some(TEST_SECRET))
        .await
        .expect("connect");

    let snap = c
        .request("session.snapshot", serde_json::json!({}))
        .await
        .expect("snapshot");
    assert_eq!(snap["protocolVersion"], 1);
    assert!(snap["workspaces"].is_array());
    assert!(snap["panes"].is_array());
    // See the module docs: if home-directory isolation didn't hold, this is
    // where a developer's real panes would show up. Trust nothing else this
    // test observes unless this holds.
    assert_eq!(
        snap["panes"].as_array().unwrap().len(),
        0,
        "isolation failed: the runtime saw real data instead of a fresh home directory: {snap}"
    );

    // The catalogue the client relies on must be present and complete.
    let methods = c
        .request("node.methods", serde_json::json!({}))
        .await
        .expect("methods");
    let sync = methods["sync"].as_array().unwrap();
    for required in [
        "session.snapshot",
        "pane.create",
        "pane.close",
        "workspace.create",
        "agent.prompt",
    ] {
        assert!(
            sync.iter().any(|m| m == required),
            "runtime is missing {required}"
        );
    }

    // Subscribe, then make something happen and see the event arrive.
    let ack = c.subscribe(0).await.expect("subscribe");
    assert!(!ack.gap);
    let mut rx = c.events();

    let ws = c
        .request("workspace.create", serde_json::json!({"name":"tui-itest"}))
        .await
        .expect("workspace.create");
    let ws_id = ws["workspaceId"].as_str().unwrap().to_string();

    let ev = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
        .await
        .expect("no event within 10s")
        .expect("event channel closed");
    assert_eq!(ev.r#type, "workspace.created");

    // Clean up so a re-run starts fresh.
    c.request("workspace.close", serde_json::json!({"workspaceId": ws_id}))
        .await
        .expect("workspace.close");
}
