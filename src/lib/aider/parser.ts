import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

const HISTORY_FILE = '.aider.chat.history.md';
const USER_MESSAGE_PREFIX = '#### ';

export interface AiderSessionMeta {
  projectPath: string;
  firstPrompt: string;
  messageCount: number;
  modified: string;
  created: string;
}

/**
 * Generate a deterministic session ID from a project path.
 * Returns 'aider-' + first 16 hex chars of sha256(path).
 */
export function aiderSessionId(projectPath: string): string {
  const hash = crypto.createHash('sha256').update(projectPath).digest('hex');
  return 'aider-' + hash.slice(0, 16);
}

/**
 * Generate a deterministic project ID from a project path.
 * Returns 'aider-proj-' + first 12 hex chars of sha256(path).
 */
export function aiderProjectId(projectPath: string): string {
  const hash = crypto.createHash('sha256').update(projectPath).digest('hex');
  return 'aider-proj-' + hash.slice(0, 12);
}

/**
 * Parse a single .aider.chat.history.md file and extract session metadata.
 * Returns null if the file doesn't exist or has 0 messages.
 */
function parseHistoryFile(projectDir: string): AiderSessionMeta | null {
  const filePath = path.join(projectDir, HISTORY_FILE);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let messageCount = 0;
  let firstPrompt = '';

  for (const line of content.split('\n')) {
    if (line.startsWith(USER_MESSAGE_PREFIX)) {
      messageCount++;
      if (!firstPrompt) {
        firstPrompt = line.slice(USER_MESSAGE_PREFIX.length).trim().slice(0, 200);
      }
    }
  }

  if (messageCount === 0) {
    return null;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  const modified = stat.mtime.toISOString();
  // birthtime falls back to ctime on Linux/filesystems that don't track it
  const created = (stat.birthtime && stat.birthtime.getTime() > 0
    ? stat.birthtime
    : stat.ctime
  ).toISOString();

  return {
    projectPath: projectDir,
    firstPrompt,
    messageCount,
    modified,
    created,
  };
}

/**
 * Scan a list of project directories for Aider chat history files.
 * Deduplicates directories and skips files with 0 messages.
 */
export function scanAiderSessions(projectDirs: string[]): AiderSessionMeta[] {
  const seen = new Set<string>();
  const results: AiderSessionMeta[] = [];

  for (const dir of projectDirs) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    const meta = parseHistoryFile(resolved);
    if (meta) {
      results.push(meta);
    }
  }

  return results;
}
