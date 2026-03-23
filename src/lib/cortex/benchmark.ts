import { getCortexAddon } from './index';
import { getUserPaths } from '../config';
import { getCurrentUser } from '../auth';
import path from 'path';

let _access: any = null;

export function getBenchmarkAccess(): any {
  if (_access) return _access;

  const addon = getCortexAddon();
  if (!addon?.BenchmarkDataAccess) return null;

  const user = getCurrentUser();
  const { spacesDir } = getUserPaths(user);

  // Check candidate paths: user's cortex dir first, then the local dev results dir
  const candidates = [
    path.join(spacesDir, 'cortex', 'benchmark.db'),
    path.join(process.cwd(), 'tests', 'benchmark', 'results', 'benchmark.db'),
  ];

  for (const dbPath of candidates) {
    const access = new addon.BenchmarkDataAccess(dbPath);
    if (access.isAvailable()) {
      _access = access;
      return _access;
    }
    access.close();
  }

  return null;
}

export function resetBenchmarkAccess(): void {
  if (_access) {
    _access.close();
    _access = null;
  }
}
