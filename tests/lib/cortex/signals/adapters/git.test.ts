import { describe, it, expect } from 'vitest';
import { parseGitLog } from '@/lib/cortex/signals/adapters/git';
import type { GitLogEntry } from '@/lib/cortex/signals/adapters/git';
import type { EdgeUpdate } from '@/lib/cortex/signals/types';

function makeEntry(overrides: Partial<GitLogEntry> = {}): GitLogEntry {
  return {
    sha: 'abc1234',
    author: 'alice@example.com',
    authorName: 'Alice Dev',
    date: '2025-01-15T10:00:00Z',
    message: 'fix: resolve null pointer in user auth',
    files: ['src/auth/login.ts', 'src/auth/session.ts'],
    ...overrides,
  };
}

describe('parseGitLog', () => {
  it('parses a commit into a SignalEnvelope', () => {
    const entry = makeEntry({ message: 'fix: resolve null pointer in user auth' });
    const results = parseGitLog(entry);

    expect(results).toHaveLength(1);
    const envelope = results[0];

    expect(envelope.suggested_type).toBe('error_fix');
    expect(envelope.origin.source_type).toBe('git_commit');
    expect(envelope.origin.source_ref).toBe('abc1234');
    expect(envelope.origin.creator_entity_id).toBe('person-alice-dev');
    expect(envelope.raw_metadata.file_refs).toEqual([
      'src/auth/login.ts',
      'src/auth/session.ts',
    ]);
  });

  it('classifies refactor commits as decisions', () => {
    const entry = makeEntry({ message: 'refactor: extract payment service into separate module' });
    const results = parseGitLog(entry);

    expect(results).toHaveLength(1);
    expect(results[0].suggested_type).toBe('decision');
  });

  it('classifies generic commits as context', () => {
    const entry = makeEntry({ message: 'update dependencies to latest versions' });
    const results = parseGitLog(entry);

    expect(results).toHaveLength(1);
    expect(results[0].suggested_type).toBe('context');
  });

  it('includes edge updates for author TOUCHES files', () => {
    const entry = makeEntry({
      authorName: 'Bob Smith',
      files: ['src/api/users.ts'],
    });
    const results = parseGitLog(entry);

    expect(results).toHaveLength(1);
    const edgeUpdates = results[0].raw_metadata.edge_updates as EdgeUpdate[];
    expect(edgeUpdates).toHaveLength(1);
    expect(edgeUpdates[0].source_id).toBe('person-bob-smith');
    expect(edgeUpdates[0].relation).toBe('touches');
    expect(edgeUpdates[0].weight_delta).toBe(0.05);
  });

  it('skips merge commits', () => {
    const entry = makeEntry({ message: "Merge branch 'feature/foo' into main" });
    const results = parseGitLog(entry);

    expect(results).toHaveLength(0);
  });
});
