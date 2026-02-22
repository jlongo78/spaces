import { AsyncLocalStorage } from 'async_hooks';
import { NextRequest } from 'next/server';
import os from 'os';
import { HAS_AUTH } from '@/lib/tier';

const userStore = new AsyncLocalStorage<string>();

/**
 * Extract the authenticated username from SSO headers.
 * Falls back to the OS user for local development.
 */
export function getAuthUser(request: NextRequest): string {
  return request.headers.get('x-auth-user') || os.userInfo().username;
}

/**
 * Run a function within a user context, so getDb() and other
 * user-scoped operations resolve to the correct user.
 */
export function withUser<T>(username: string, fn: () => T): T {
  return userStore.run(username, fn);
}

/**
 * Extract the user's role from request headers.
 * Desktop mode defaults to 'admin'; server mode reads the middleware-set header.
 */
export function getAuthRole(request: NextRequest): string {
  if (!HAS_AUTH) return 'admin';
  return request.headers.get('x-auth-role') || 'user';
}

/**
 * Get the current user from AsyncLocalStorage context.
 * Falls back to the OS user for local dev or background tasks.
 */
export function getCurrentUser(): string {
  const user = userStore.getStore();
  if (!user) return os.userInfo().username;
  return user;
}
