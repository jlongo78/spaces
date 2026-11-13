import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { spawnPane, buildLaunchCommand, AGENTS, findSshBinary, buildPaneEnv } from '../../bin/lib/runtime/spawn-pane.js';

describe('AGENTS table', () => {
  it('carries every supported agent with its resume style', () => {
    expect(Object.keys(AGENTS).sort()).toEqual(
      ['aider', 'claude', 'codex', 'custom', 'forge', 'gemini', 'pi', 'shell'].sort(),
    );
    expect(AGENTS.claude).toEqual({ command: 'claude', resumeFlag: '--resume', resumeStyle: 'flag' });
    expect(AGENTS.codex.resumeStyle).toBe('subcommand');
  });
});

describe('buildLaunchCommand', () => {
  it('returns empty string for shell and unknown types', () => {
    expect(buildLaunchCommand({ agentType: 'shell' })).toBe('');
    expect(buildLaunchCommand({ agentType: 'nonesuch' })).toBe('');
  });

  it('returns the bare command with no session', () => {
    expect(buildLaunchCommand({ agentType: 'claude' })).toBe('claude');
    expect(buildLaunchCommand({ agentType: 'claude', agentSession: 'new' })).toBe('claude');
  });

  it('appends a flag-style resume', () => {
    expect(buildLaunchCommand({ agentType: 'claude', agentSession: 'abc123' })).toBe('claude --resume abc123');
  });

  it('appends a subcommand-style resume', () => {
    expect(buildLaunchCommand({ agentType: 'codex', agentSession: 'abc123' })).toBe('codex resume abc123');
  });

  it('ignores a session for an agent that cannot resume', () => {
    expect(buildLaunchCommand({ agentType: 'aider', agentSession: 'abc123' })).toBe('aider');
  });

  it('uses the custom command verbatim', () => {
    expect(buildLaunchCommand({ agentType: 'custom', customCommand: 'my-tool --flag' })).toBe('my-tool --flag');
    expect(buildLaunchCommand({ agentType: 'custom' })).toBe('');
  });
});

describe('buildPaneEnv', () => {
  // Regression test: pane.create used to pass `env: process.env` straight
  // through, inheriting the server's own secrets. This is the extracted helper
  // both the legacy /ws path (terminal-server.js) and pane.create (index.js)
  // now share instead.
  it('forwards only allowlisted keys — never a secret-looking var it was not told about', () => {
    const sourceEnv = {
      PATH: '/usr/bin', HOME: '/home/x', TERM: 'xterm-256color',
      SPACES_SESSION_SECRET: 'shh', GH_PAT: 'ghp_x', NPM_TOKEN: 'npm_x', ANTHROPIC_API_KEY: 'sk-x',
    };
    const env = buildPaneEnv({ paneId: 'p1', apiPort: 4000, sourceEnv });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/x');
    expect(env.SPACES_SESSION_SECRET).toBeUndefined();
    expect(env.GH_PAT).toBeUndefined();
    expect(env.NPM_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('always sets the agent-bus wiring and the prompt-suggestion flag', () => {
    const env = buildPaneEnv({ paneId: 'pane-abc', apiPort: 4000, sourceEnv: {} });
    expect(env.SPACES_PANE_ID).toBe('pane-abc');
    expect(env.SPACES_API_URL).toBe('http://localhost:4000');
    expect(env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION).toBe('true');
  });

  // The hook and MCP server run inside the pane and must find the same data
  // folder as the server (hook-env, internal_token, hook-state).
  it('carries the resolved SPACES_HOME when it is set', () => {
    vi.stubEnv('SPACES_HOME', 'rel-spaces-home');
    try {
      const env = buildPaneEnv({ paneId: 'p1', apiPort: 4000, sourceEnv: process.env });
      expect(env.SPACES_HOME).toBe(path.resolve('rel-spaces-home'));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('omits SPACES_HOME when it is unset or blank', () => {
    expect(buildPaneEnv({ paneId: 'p1', apiPort: 4000, sourceEnv: {} }).SPACES_HOME).toBeUndefined();
    expect(buildPaneEnv({ paneId: 'p1', apiPort: 4000, sourceEnv: { SPACES_HOME: '  ' } }).SPACES_HOME).toBeUndefined();
  });
});

// A fake PTY that records what it was asked to do, so the wiring can be
// asserted without spawning a real process.
function fakePtyLib() {
  const calls: any = { spawn: [], writes: [], resizes: [] };
  let onData: ((d: string) => void) | null = null;
  let onExit: ((e: { exitCode: number }) => void) | null = null;
  const lib = {
    spawn(file: string, args: string[], opts: any) {
      calls.spawn.push({ file, args, opts });
      return {
        write: (d: string) => calls.writes.push(d),
        resize: (c: number, r: number) => calls.resizes.push([c, r]),
        onData: (fn: any) => { onData = fn; },
        onExit: (fn: any) => { onExit = fn; },
        kill: () => {},
      };
    },
  };
  return { lib, calls, emitData: (d: string) => onData?.(d), emitExit: (c: number) => onExit?.({ exitCode: c }) };
}

function fakeRuntime() {
  const seen: any = { registered: [], fed: [], exited: [] };
  return {
    seen,
    registerPane(paneId: string, opts: any) { seen.registered.push({ paneId, opts }); return { screen: {} }; },
    feed(paneId: string, data: string) { seen.fed.push([paneId, data]); },
    paneExit(paneId: string, code: number) { seen.exited.push([paneId, code]); },
  };
}

describe('spawnPane', () => {
  const base = { paneId: 'p1', cwd: 'C:\\work', cols: 100, rows: 30, env: { PATH: 'x' }, workspaceId: 'w1' };

  it('spawns a shell and registers the pane with the runtime', () => {
    const pty = fakePtyLib();
    const runtime = fakeRuntime();
    const res = spawnPane({ ...base, agentType: 'claude', runtime, ptyLib: pty.lib }) as any;
    expect(res.ok).toBe(true);
    expect(pty.calls.spawn).toHaveLength(1);
    expect(pty.calls.spawn[0].opts).toMatchObject({ cols: 100, rows: 30, cwd: 'C:\\work' });
    expect(runtime.seen.registered[0].paneId).toBe('p1');
    expect(runtime.seen.registered[0].opts).toMatchObject({ agentType: 'claude', cwd: 'C:\\work', workspaceId: 'w1' });
  });

  // Regression test: registerPane initialized term:null and only pane.create's
  // own manual `rec.term = spawned.term` (index.js) ever filled it in — a pane
  // spawned via any other caller (the legacy /ws handler) never got that
  // assignment, so pane.close/workspace.close could never actually kill it.
  // spawnPane must hand the PTY handle to registerPane itself so every caller
  // gets it for free.
  it('threads the spawned term through to registerPane so every caller gets it, not just pane.create', () => {
    const pty = fakePtyLib();
    const runtime = fakeRuntime();
    const res = spawnPane({ ...base, agentType: 'shell', runtime, ptyLib: pty.lib }) as any;
    expect(runtime.seen.registered[0].opts.term).toBe(res.term);
    expect(res.term).toBeDefined();
  });

  it('returns the launch command without writing it', () => {
    const pty = fakePtyLib();
    const res = spawnPane({
      ...base, agentType: 'claude', agentSession: 'sess1', runtime: fakeRuntime(), ptyLib: pty.lib,
    }) as any;
    expect(res.launchCommand).toBe('claude --resume sess1');
    expect(pty.calls.writes).toEqual([]);
  });

  it('forwards pty output into the runtime', () => {
    const pty = fakePtyLib();
    const runtime = fakeRuntime();
    spawnPane({ ...base, agentType: 'shell', runtime, ptyLib: pty.lib });
    pty.emitData('hello');
    expect(runtime.seen.fed).toEqual([['p1', 'hello']]);
  });

  it('reports pane exit to the runtime', () => {
    const pty = fakePtyLib();
    const runtime = fakeRuntime();
    spawnPane({ ...base, agentType: 'shell', runtime, ptyLib: pty.lib });
    pty.emitExit(3);
    expect(runtime.seen.exited).toEqual([['p1', 3]]);
  });

  it('wires runtime input and resize through to the pty', () => {
    const pty = fakePtyLib();
    const runtime = fakeRuntime();
    spawnPane({ ...base, agentType: 'shell', runtime, ptyLib: pty.lib });
    const opts = runtime.seen.registered[0].opts;
    opts.onInput('ls\r');
    opts.onResize(120, 40);
    expect(pty.calls.writes).toEqual(['ls\r']);
    expect(pty.calls.resizes).toEqual([[120, 40]]);
  });

  it('returns an error instead of throwing when spawn fails', () => {
    const throwing = { spawn() { throw new Error('ENOENT: no shell'); } };
    const res = spawnPane({ ...base, agentType: 'shell', runtime: fakeRuntime(), ptyLib: throwing }) as any;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ENOENT/);
  });

  it('survives a runtime whose registerPane throws', () => {
    const pty = fakePtyLib();
    const hostile = { ...fakeRuntime(), registerPane() { throw new Error('runtime down'); } };
    const res = spawnPane({ ...base, agentType: 'shell', runtime: hostile as any, ptyLib: pty.lib }) as any;
    // The PTY spawned fine; runtime bookkeeping is best-effort, exactly as
    // the legacy path treats it.
    expect(res.ok).toBe(true);
  });
});

describe('spawnPane SSH remoting', () => {
  const base = { paneId: 'p1', cwd: 'C:\\work', cols: 100, rows: 30, env: { PATH: 'x' }, workspaceId: 'w1' };
  // Guaranteed to differ from the local OS user regardless of which machine
  // runs this suite — the real code's isSSH check is an identity mismatch.
  const remoteUser = `${os.userInfo().username}-remote`;
  const knownHosts = path.join(os.homedir(), '.spaces', 'known_hosts');

  it('spawns over ssh when shellUser differs from the local OS user, using the exact real-code argv', () => {
    const pty = fakePtyLib();
    const runtime = fakeRuntime();
    const res = spawnPane({
      ...base, agentType: 'shell', runtime, ptyLib: pty.lib,
      shellUser: remoteUser, sshKeyPath: 'C:\\keys\\alice_id_ed25519',
    }) as any;
    expect(res.ok).toBe(true);
    expect(pty.calls.spawn).toHaveLength(1);
    // "the exact file ... the real code would produce" — computed via the
    // module's own findSshBinary, the same resolution spawnPane uses
    // internally, rather than a machine-specific hard-coded path.
    expect(pty.calls.spawn[0].file).toBe(findSshBinary());
    expect(pty.calls.spawn[0].args).toEqual([
      '-4',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', `UserKnownHostsFile=${knownHosts}`,
      '-i', 'C:\\keys\\alice_id_ed25519',
      '-t',
      `${remoteUser}@localhost`,
    ]);
  });

  it('falls back to the shared service key when no sshKeyPath is supplied', () => {
    const pty = fakePtyLib();
    const res = spawnPane({
      ...base, agentType: 'shell', runtime: fakeRuntime(), ptyLib: pty.lib, shellUser: remoteUser,
    }) as any;
    expect(res.ok).toBe(true);
    const keyIndex = pty.calls.spawn[0].args.indexOf('-i');
    expect(pty.calls.spawn[0].args[keyIndex + 1]).toBe(path.join(os.homedir(), '.spaces', 'service_key'));
  });

  it('leaves the local branches unchanged when no shellUser is supplied', () => {
    const pty = fakePtyLib();
    const runtime = fakeRuntime();
    const res = spawnPane({ ...base, agentType: 'claude', runtime, ptyLib: pty.lib }) as any;
    expect(res.ok).toBe(true);
    // No SSH params at all -> plain/git-bash branches, both of which use an
    // empty argv (unlike the ssh branch's populated argv).
    expect(pty.calls.spawn[0].args).toEqual([]);
  });

  it('picks SSH over the Windows git-bash branch when both could match (real-code precedence)', () => {
    const pty = fakePtyLib();
    const runtime = fakeRuntime();
    // agentType 'claude' on Windows would select git-bash (args: []) if SSH
    // weren't in play. Supplying a mismatched shellUser must still win,
    // exactly as the real code's isSSH check runs before the git-bash
    // branch.
    const res = spawnPane({
      ...base, agentType: 'claude', runtime, ptyLib: pty.lib, shellUser: remoteUser,
    }) as any;
    expect(res.ok).toBe(true);
    expect(pty.calls.spawn[0].file).toBe(findSshBinary());
    expect(pty.calls.spawn[0].args).toContain('-t');
    expect(pty.calls.spawn[0].args).toContain(`${remoteUser}@localhost`);
  });
});
