import { describe, it, expect } from 'vitest';
import { getTrickleMode, TRICKLE_DEFAULTS } from '@/lib/cortex/gravity/trickle';

describe('getTrickleMode', () => {
  it('returns push for org-level decisions', () => {
    const mode = getTrickleMode('decision', 'organization');
    expect(mode).toBe('push');
  });

  it('returns push for security policies (topics include "security")', () => {
    // pattern would normally be 'visibility', but security topic overrides to 'push'
    const mode = getTrickleMode('pattern', 'organization', ['security', 'policy']);
    expect(mode).toBe('push');
  });

  it('returns visibility for best practices (pattern at org)', () => {
    const mode = getTrickleMode('pattern', 'organization');
    expect(mode).toBe('visibility');
  });

  it('returns visibility for general patterns (conversation at org)', () => {
    const mode = getTrickleMode('conversation', 'organization');
    expect(mode).toBe('visibility');
  });

  it('returns null for non-org scopes (decision at team)', () => {
    expect(getTrickleMode('decision', 'team')).toBeNull();
    expect(getTrickleMode('decision', 'personal')).toBeNull();
    expect(getTrickleMode('decision', 'department')).toBeNull();
  });

  it('exports the trickle defaults table with correct push/visibility assignments', () => {
    expect(TRICKLE_DEFAULTS.decision).toBe('push');
    expect(TRICKLE_DEFAULTS.preference).toBe('push');
    expect(TRICKLE_DEFAULTS.pattern).toBe('visibility');
    expect(TRICKLE_DEFAULTS.error_fix).toBe('visibility');
    expect(TRICKLE_DEFAULTS.conversation).toBe('visibility');
    expect(TRICKLE_DEFAULTS.code_pattern).toBe('visibility');
    expect(TRICKLE_DEFAULTS.command).toBe('visibility');
    expect(TRICKLE_DEFAULTS.context).toBe('visibility');
    expect(TRICKLE_DEFAULTS.summary).toBe('visibility');
  });
});
