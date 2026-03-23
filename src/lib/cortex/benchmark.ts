import { getCortexAddon } from './index';
import { getUserPaths } from '../config';
import { getCurrentUser } from '../auth';
import path from 'path';
import type { ChildProcess } from 'node:child_process';

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

// ---------------------------------------------------------------------------
// Benchmark process tracking
// ---------------------------------------------------------------------------

interface BenchmarkProcessInfo {
  process: ChildProcess;
  pid: number;
  startedAt: string;
  preset: string;
  categories: string;
  model: string;
  noJudge: boolean;
  getOutput: () => string;
  getErrors: () => string;
}

let _benchmarkProcess: BenchmarkProcessInfo | null = null;

export function getBenchmarkProcess(): BenchmarkProcessInfo | null {
  return _benchmarkProcess;
}

export function setBenchmarkProcess(info: BenchmarkProcessInfo): void {
  _benchmarkProcess = info;
}
