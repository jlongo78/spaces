import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { getBenchmarkProcess, setBenchmarkProcess } from '@/lib/cortex/benchmark';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  const body = await request.json();

  return withUser(user, async () => {
    // Check if already running
    const existing = getBenchmarkProcess();
    if (existing && !existing.process.killed && existing.process.exitCode === null) {
      return NextResponse.json({ error: 'A benchmark is already running' }, { status: 409 });
    }

    const {
      preset = 'quick',
      categories,
      noJudge = false,
      model = 'claude-haiku-4-5',
    } = body;

    // Build args for the benchmark CLI
    const args = ['tests/benchmark/index.ts'];
    args.push('--preset', preset);
    if (categories) args.push('--category', categories);
    if (noJudge) args.push('--no-judge');
    args.push('--models', model);

    // Find the cortex repo
    const cortexDir = findCortexDir();
    if (!cortexDir) {
      return NextResponse.json({ error: 'Could not find @spaces/cortex directory' }, { status: 500 });
    }

    // Spawn the benchmark process
    const child = spawn('npx', ['tsx', ...args], {
      cwd: cortexDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      detached: false,
    });

    let output = '';
    let errorOutput = '';
    child.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { errorOutput += data.toString(); });

    setBenchmarkProcess({
      process: child,
      pid: child.pid ?? 0,
      startedAt: new Date().toISOString(),
      preset,
      categories: categories || 'all',
      model,
      noJudge,
      getOutput: () => output,
      getErrors: () => errorOutput,
    });

    child.on('close', () => {
      // Process finished — exitCode will be set on the child object
    });

    return NextResponse.json({
      started: true,
      pid: child.pid,
      preset,
      categories: categories || 'all',
      model,
    });
  });
}

function findCortexDir(): string | null {
  const candidates = [
    path.resolve(process.cwd(), '../spaces-cortex'),
    path.resolve(process.cwd(), '../../spaces-cortex'),
    'C:\\projects\\spaces-cortex',
    '/c/projects/spaces-cortex',
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'tests', 'benchmark', 'index.ts'))) {
      return dir;
    }
  }
  return null;
}
