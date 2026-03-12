import { vi } from 'vitest';

// Mock the auth module for tests - Cortex tests don't need real auth
vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => 'test-user',
  getAuthUser: () => 'test-user',
  withUser: (_user: string, fn: () => any) => fn(),
}));
