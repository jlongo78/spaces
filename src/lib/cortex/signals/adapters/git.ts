import { execSync } from 'child_process';
import type { SignalAdapter, SignalEnvelope, EdgeUpdate } from '../types';
import { slugify } from '@/lib/cortex/graph/types';

export interface GitLogEntry {
  sha: string;
  author: string;
  authorName: string;
  date: string;
  message: string;
  files: string[];
}

const MERGE_PATTERN = /^Merge\s+(branch|pull\s+request|remote)/i;

export function parseGitLog(entry: GitLogEntry): SignalEnvelope[] {
  // Skip merge commits
  if (MERGE_PATTERN.test(entry.message)) return [];

  // Skip very short messages
  if (entry.message.trim().length < 10) return [];

  // Classify the commit
  const msg = entry.message.toLowerCase();
  let suggested_type: 'error_fix' | 'decision' | 'context';
  if (/fix|bug|hotfix/.test(msg)) {
    suggested_type = 'error_fix';
  } else if (/refactor|migrat|switch to|replace with|feat/.test(msg)) {
    suggested_type = 'decision';
  } else {
    suggested_type = 'context';
  }

  // Build edge updates: author TOUCHES each file
  const authorSlug = slugify(entry.authorName);
  const authorId = `person-${authorSlug}`;
  const edge_updates: EdgeUpdate[] = entry.files.map((file) => ({
    source_id: authorId,
    target_id: `module-${slugify(file)}`,
    relation: 'touches',
    weight_delta: 0.05,
  }));

  const envelope: SignalEnvelope = {
    text: entry.message,
    origin: {
      source_type: 'git_commit',
      source_ref: entry.sha,
      creator_entity_id: authorId,
    },
    entities: [],
    suggested_type,
    suggested_sensitivity: 'internal',
    raw_metadata: {
      sha: entry.sha,
      author: entry.author,
      authorName: entry.authorName,
      date: entry.date,
      file_refs: entry.files,
      edge_updates,
    },
  };

  return [envelope];
}

export class GitAdapter implements SignalAdapter {
  name = 'git';
  schedule = 'polling' as const;

  constructor(
    private readonly repoPath: string,
    private readonly sinceDate?: string,
  ) {}

  async *extract(): AsyncIterable<SignalEnvelope> {
    const since = this.sinceDate ? `--since="${this.sinceDate}"` : '';
    // Format: sha|author-email|author-name|date|message\nfiles...
    const separator = '---COMMIT---';
    const format = `--pretty=format:"${separator}%n%H|%ae|%an|%aI|%s" --name-only`;
    const cmd = `git -C "${this.repoPath}" log ${format} ${since}`;

    let output: string;
    try {
      output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      return;
    }

    const blocks = output.split(separator).filter((b) => b.trim().length > 0);

    for (const block of blocks) {
      const lines = block.trim().split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 0) continue;

      const headerLine = lines[0].trim();
      const parts = headerLine.split('|');
      if (parts.length < 5) continue;

      const [sha, author, authorName, date, ...messageParts] = parts;
      const message = messageParts.join('|');
      const files = lines.slice(1).map((l) => l.trim()).filter(Boolean);

      const entry: GitLogEntry = { sha, author, authorName, date, message, files };
      for (const envelope of parseGitLog(entry)) {
        yield envelope;
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      execSync(`git -C "${this.repoPath}" rev-parse HEAD`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      return false;
    }
  }
}
