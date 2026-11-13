// writeAgentConfig must hand SPACES_HOME to the spaces-bus MCP server:
// Claude Code / Codex pass MCP servers only the env in their config file.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error plain JS module without types
import { writeAgentConfig } from '../../src/lib/terminal/collaboration.js';

describe('writeAgentConfig and SPACES_HOME', () => {
  let tmp: string;
  let cwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-home-'));
    cwd = path.join(tmp, 'project');
    fs.mkdirSync(cwd);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('puts the resolved SPACES_HOME into the .mcp.json env when set', () => {
    const data = path.join(tmp, 'data');
    vi.stubEnv('SPACES_HOME', data);
    writeAgentConfig('claude', cwd, { SPACES_PANE_ID: 'p1', SPACES_API_URL: 'http://localhost:1' });
    const mcp = JSON.parse(fs.readFileSync(path.join(cwd, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers['spaces-bus'].env.SPACES_HOME).toBe(data);
    // The hook's per-pane env lands in the custom folder, not ~/.spaces.
    expect(fs.existsSync(path.join(data, 'hook-env', 'p1.json'))).toBe(true);
  });

  it('puts SPACES_HOME into the Codex TOML env when set', () => {
    const data = path.join(tmp, 'data');
    vi.stubEnv('SPACES_HOME', data);
    writeAgentConfig('codex', cwd, {});
    const toml = fs.readFileSync(path.join(cwd, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain(`SPACES_HOME = ${JSON.stringify(data)}`);
  });

  it('leaves SPACES_HOME out when unset', () => {
    vi.stubEnv('SPACES_HOME', '');
    // Codex path: never touches the data folder, so the real ~/.spaces is safe.
    writeAgentConfig('codex', cwd, {});
    const toml = fs.readFileSync(path.join(cwd, '.codex', 'config.toml'), 'utf8');
    expect(toml).not.toContain('SPACES_HOME');
  });
});
