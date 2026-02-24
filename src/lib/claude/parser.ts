import fs from 'fs';
import readline from 'readline';
import type { SessionIndex, ParsedMessage, ContentBlock } from '@/types/claude';

/**
 * Parse a sessions-index.json file
 */
export function parseSessionIndex(filePath: string): SessionIndex | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as SessionIndex;
  } catch {
    return null;
  }
}

/**
 * Count conversation messages in a JSONL file (user + assistant only)
 */
export function countConversationMessages(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    let count = 0;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'user' || parsed.type === 'assistant') {
          count++;
        }
      } catch {
        // skip malformed lines
      }
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Stream messages from a JSONL file with pagination
 * Returns only user/assistant/system messages (conversation messages)
 */
export async function readMessages(
  filePath: string,
  offset: number = 0,
  limit: number = 50
): Promise<{ messages: ParsedMessage[]; total: number; hasMore: boolean }> {
  return new Promise((resolve, reject) => {
    const messages: ParsedMessage[] = [];
    let total = 0;
    let collected = 0;

    if (!fs.existsSync(filePath)) {
      resolve({ messages: [], total: 0, hasMore: false });
      return;
    }

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line: string) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'user' || parsed.type === 'assistant' || parsed.type === 'system') {
          if (total >= offset && collected < limit) {
            messages.push(parsed as ParsedMessage);
            collected++;
          }
          total++;
        }
      } catch {
        // skip malformed lines
      }
    });

    rl.on('close', () => {
      resolve({ messages, total, hasMore: total > offset + limit });
    });

    rl.on('error', reject);
  });
}

/**
 * Extract plain text from message content for FTS indexing
 */
export function extractTextFromMessage(msg: ParsedMessage): string {
  if (msg.type === 'user' && 'message' in msg) {
    const content = msg.message.content;
    return typeof content === 'string' ? content : '';
  }

  if (msg.type === 'assistant' && 'message' in msg) {
    const blocks = msg.message.content;
    if (!Array.isArray(blocks)) return '';
    return blocks
      .filter((b: ContentBlock) => b.type === 'text' && b.text)
      .map((b: ContentBlock) => b.text!)
      .join('\n');
  }

  return '';
}

/**
 * Extract text from all messages in a JSONL file for FTS indexing
 */
export async function extractAllText(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    const texts: string[] = [];

    if (!fs.existsSync(filePath)) {
      resolve('');
      return;
    }

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line: string) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'user' || parsed.type === 'assistant') {
          const text = extractTextFromMessage(parsed as ParsedMessage);
          if (text) texts.push(text);
        }
      } catch {
        // skip
      }
    });

    rl.on('close', () => {
      resolve(texts.join('\n').slice(0, 100000)); // Cap at 100KB per session for FTS
    });
  });
}

/**
 * Read stats-cache.json
 */
export function readStatsCache(statsPath: string) {
  try {
    const content = fs.readFileSync(statsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Scan a JSONL file for metadata when no sessions-index.json exists
 */
export async function scanJSONLMetadata(filePath: string): Promise<{
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  model: string;
} | null> {
  return new Promise((resolve) => {
    let firstPrompt = '';
    let messageCount = 0;
    let created = '';
    let modified = '';
    let gitBranch = '';
    let projectPath = '';
    let model = '';

    if (!fs.existsSync(filePath)) {
      resolve(null);
      return;
    }

    const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line: string) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'user' || parsed.type === 'assistant') {
          messageCount++;
          if (parsed.timestamp) {
            if (!created) created = parsed.timestamp;
            modified = parsed.timestamp;
          }
        }
        if (parsed.type === 'user' && !firstPrompt) {
          const content = parsed.message?.content;
          firstPrompt = typeof content === 'string' ? content.slice(0, 200) : '';
          gitBranch = parsed.gitBranch || '';
          projectPath = parsed.cwd || '';
        }
        if (parsed.type === 'assistant' && !model) {
          model = parsed.message?.model || '';
        }
      } catch {
        // skip
      }
    });

    rl.on('close', () => {
      resolve({ firstPrompt, messageCount, created, modified, gitBranch, projectPath, model });
    });
  });
}
