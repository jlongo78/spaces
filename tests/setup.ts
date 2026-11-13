import { vi } from 'vitest';

// Never let a test process arm a real network-bound detection-manifest
// refresh timer: several suites (runtime.test.ts alone calls createRuntime
// 13 times) construct real runtimes, and under vitest's forks pool a
// long-lived worker can otherwise fire genuine outbound requests mid-suite.
process.env.SPACES_NO_DETECTION_UPDATE = '1';

// Tests must not read or write a developer's own SPACES_HOME folder. Suites
// that need it set use vi.stubEnv; child processes spawned with
// {...process.env} inherit none.
delete process.env.SPACES_HOME;

// Mock the auth module for tests that don't need real auth
vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => 'test-user',
  getAuthUser: () => 'test-user',
  withUser: (_user: string, fn: () => any) => fn(),
}));
