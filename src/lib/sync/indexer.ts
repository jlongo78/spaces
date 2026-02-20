import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { parseSessionIndex, scanJSONLMetadata, extractAllText } from '../claude/parser';
import { upsertProject, upsertSession, upsertFtsContent } from '../db/queries';
import { getDb } from '../db/schema';

/**
 * Full sync: scan all projects and sessions from ~/.claude/projects/
 */
export async function fullSync(): Promise<{ projects: number; sessions: number }> {
  const projectsDir = config.claudeProjectsDir;

  if (!fs.existsSync(projectsDir)) {
    return { projects: 0, sessions: 0 };
  }

  const dirs = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  let projectCount = 0;
  let sessionCount = 0;

  const db = getDb();
  const insertMany = db.transaction(() => {
    for (const dir of dirs) {
      const projectDir = path.join(projectsDir, dir.name);
      const projectId = dir.name;

      // Decode project name from directory name as fallback
      let projectName = decodeProjectName(dir.name);
      let projectRealPath = projectName;

      // Try sessions-index.json first
      const indexPath = path.join(projectDir, 'sessions-index.json');
      if (fs.existsSync(indexPath)) {
        const index = parseSessionIndex(indexPath);
        if (index?.entries) {
          // Use projectPath from first entry for a better display name
          const firstEntry = index.entries.find(e => e.projectPath);
          if (firstEntry?.projectPath) {
            projectRealPath = firstEntry.projectPath;
            projectName = path.basename(firstEntry.projectPath);
          }

          upsertProject({
            id: projectId,
            name: projectName,
            path: projectRealPath,
            claudePath: projectDir,
          });
          projectCount++;

          for (const entry of index.entries) {
            upsertSession({
              id: entry.sessionId,
              sessionId: entry.sessionId,
              projectId,
              firstPrompt: entry.firstPrompt?.slice(0, 500) || '',
              summary: entry.summary || '',
              messageCount: entry.messageCount || 0,
              created: entry.created || '',
              modified: entry.modified || '',
              gitBranch: entry.gitBranch || '',
              projectPath: entry.projectPath || '',
              fullPath: entry.fullPath || '',
            });
            sessionCount++;
          }
          continue;
        }
      }

      upsertProject({
        id: projectId,
        name: projectName,
        path: projectRealPath,
        claudePath: projectDir,
      });
      projectCount++;

      // Fallback: scan JSONL files directly
      const files = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl') && !f.startsWith('.'));

      for (const file of files) {
        const filePath = path.join(projectDir, file);
        const sessionId = file.replace('.jsonl', '');

        upsertSession({
          id: sessionId,
          sessionId,
          projectId,
          firstPrompt: '',
          summary: '',
          messageCount: 0,
          created: '',
          modified: '',
          gitBranch: '',
          projectPath: '',
          fullPath: filePath,
        });
        sessionCount++;
      }
    }
  });

  insertMany();

  return { projects: projectCount, sessions: sessionCount };
}

/**
 * Scan JSONL files that don't have sessions-index.json metadata
 * to fill in firstPrompt, messageCount, etc.
 */
export async function enrichMissingSessions(): Promise<number> {
  const db = getDb();
  const missing = db.prepare(`
    SELECT id, full_path FROM sessions
    WHERE (first_prompt = '' OR first_prompt IS NULL) AND full_path != ''
  `).all() as { id: string; full_path: string }[];

  let enriched = 0;

  for (const session of missing) {
    if (!fs.existsSync(session.full_path)) continue;

    const meta = await scanJSONLMetadata(session.full_path);
    if (meta) {
      db.prepare(`
        UPDATE sessions SET
          first_prompt = ?, message_count = ?, created = ?, modified = ?,
          git_branch = ?, project_path = ?
        WHERE id = ?
      `).run(
        meta.firstPrompt, meta.messageCount, meta.created, meta.modified,
        meta.gitBranch, meta.projectPath, session.id
      );
      enriched++;
    }
  }

  return enriched;
}

/**
 * Build FTS index for all sessions (background task)
 */
export async function buildFtsIndex(onProgress?: (done: number, total: number) => void): Promise<number> {
  const db = getDb();
  const sessions = db.prepare(`
    SELECT s.id, s.full_path FROM sessions s
    LEFT JOIN sessions_fts f ON f.session_id = s.id
    WHERE f.session_id IS NULL AND s.full_path != ''
  `).all() as { id: string; full_path: string }[];

  let indexed = 0;

  for (const session of sessions) {
    if (!fs.existsSync(session.full_path)) continue;

    try {
      const text = await extractAllText(session.full_path);
      if (text) {
        upsertFtsContent(session.id, text);
        indexed++;
      }
    } catch {
      // Skip files that can't be read
    }

    onProgress?.(indexed, sessions.length);
  }

  return indexed;
}

/**
 * Decode a project directory name to a readable project name.
 * Claude Code encodes paths: C:\projects\buddhas_bbq -> C--projects-buddhas-bbq
 * We extract just the last meaningful path segment as the display name.
 */
function decodeProjectName(dirName: string): string {
  // Split by -- to get drive and path parts
  const parts = dirName.split('--');
  if (parts.length < 2) return dirName;

  // Get the last path segment(s) after "projects-" prefix
  const pathPart = parts.slice(1).join('/');

  // If it's like "projects-buddhas-bbq", extract "buddhas-bbq"
  // If it's like "projects", just show "projects"
  const segments = pathPart.split('-');
  if (segments[0] === 'projects' && segments.length > 1) {
    return segments.slice(1).join('-');
  }

  return pathPart;
}

/**
 * Check if sync is needed by comparing file mtimes
 */
export function isSyncNeeded(): boolean {
  const projectsDir = config.claudeProjectsDir;
  if (!fs.existsSync(projectsDir)) return false;

  try {
    const stat = fs.statSync(projectsDir);
    const db = getDb();
    const lastSync = db.prepare('SELECT MAX(last_synced) as lastSynced FROM sync_state').get() as { lastSynced: string } | undefined;

    if (!lastSync?.lastSynced) return true;
    return stat.mtimeMs > new Date(lastSync.lastSynced).getTime();
  } catch {
    return true;
  }
}
