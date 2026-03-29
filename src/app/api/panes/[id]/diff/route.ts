import { NextRequest, NextResponse } from 'next/server';
import { execFileSync } from 'child_process';
import { getAuthUser, withUser } from '@/lib/auth';
import { ensureInitialized } from '@/lib/db/init';
import { getPaneById, updatePane } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

function git(args: string[], cwd: string): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', timeout: 10000 }).trim();
  } catch (e: any) {
    throw new Error(e.stderr?.trim() || e.message);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const pane = getPaneById(id);
    if (!pane) return NextResponse.json({ error: 'Pane not found' }, { status: 404 });
    if (!pane.diffBaselineSha) return NextResponse.json({ error: 'No baseline set' }, { status: 400 });

    const cwd = pane.cwd;
    try { git(['rev-parse', '--git-dir'], cwd); }
    catch { return NextResponse.json({ error: 'Not a git repository' }, { status: 400 }); }

    // Count-only mode for polling
    const countOnly = request.nextUrl.searchParams.get('countOnly') === 'true';

    try {
      const currentSha = git(['rev-parse', 'HEAD'], cwd);
      const statusRaw = git(['status', '--porcelain'], cwd);
      const statusLines = statusRaw ? statusRaw.split('\n').filter(Boolean) : [];

      if (countOnly) {
        // Fast path: just count changed files
        let fileCount = statusLines.length;
        if (pane.diffBaselineSha !== currentSha) {
          const diffNames = git(['diff', '--name-only', pane.diffBaselineSha, 'HEAD'], cwd);
          fileCount = new Set([...statusLines.map(l => l.slice(3)), ...(diffNames ? diffNames.split('\n') : [])]).size;
        }
        return NextResponse.json({ fileCount });
      }

      // Full diff
      let diff = '';
      const files: Array<{ path: string; status: string; additions: number; deletions: number }> = [];

      // Committed changes since baseline
      if (pane.diffBaselineSha !== currentSha) {
        diff += git(['diff', pane.diffBaselineSha, 'HEAD'], cwd);
        const numstat = git(['diff', '--numstat', pane.diffBaselineSha, 'HEAD'], cwd);
        for (const line of numstat.split('\n').filter(Boolean)) {
          const [add, del, path] = line.split('\t');
          files.push({ path, status: 'modified', additions: parseInt(add) || 0, deletions: parseInt(del) || 0 });
        }
      }

      // Unstaged + staged changes
      const workingDiff = git(['diff'], cwd);
      const stagedDiff = git(['diff', '--cached'], cwd);
      if (workingDiff) diff += '\n' + workingDiff;
      if (stagedDiff) diff += '\n' + stagedDiff;

      // Untracked files
      const untracked = statusLines.filter(l => l.startsWith('??')).map(l => l.slice(3));

      // Merge working tree file statuses
      for (const line of statusLines) {
        const code = line.slice(0, 2).trim();
        const filePath = line.slice(3);
        if (code === '??' || files.some(f => f.path === filePath)) continue;
        const status = code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : code.includes('R') ? 'renamed' : 'modified';
        files.push({ path: filePath, status, additions: 0, deletions: 0 });
      }

      // Truncate large diffs
      const maxSize = 500 * 1024;
      const truncated = diff.length > maxSize;
      if (truncated) diff = diff.slice(0, maxSize);

      return NextResponse.json({
        baselineSha: pane.diffBaselineSha,
        currentSha,
        files,
        diff,
        untracked,
        truncated,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    await ensureInitialized();
    const { id } = await params;
    const pane = getPaneById(id);
    if (!pane) return NextResponse.json({ error: 'Pane not found' }, { status: 404 });

    try {
      const newSha = git(['rev-parse', 'HEAD'], pane.cwd);
      updatePane(id, { diffBaselineSha: newSha } as any);
      return NextResponse.json({ baselineSha: newSha });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  });
}
