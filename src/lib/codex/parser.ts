import fs from 'fs';
import path from 'path';

/**
 * Metadata extracted from a Codex CLI session rollout file.
 */
export interface CodexSessionMeta {
  id: string;
  cwd: string;
  timestamp: string;
  firstPrompt: string;
  messageCount: number;
  modified: string;
}

/**
 * Read the first `bytes` of a file and return the content as a UTF-8 string.
 * Uses low-level fs.openSync/readSync so we never load the entire file.
 */
function readHead(filePath: string, bytes: number): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(bytes);
    const bytesRead = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf-8', 0, bytesRead);
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Extract the session UUID from a rollout filename.
 * Expected format: rollout-<timestamp>-<session-uuid>.jsonl
 * The session UUID is the last hyphen-separated segment before .jsonl,
 * which itself is a standard UUID (8-4-4-4-12 hex).
 */
function sessionIdFromFilename(filename: string): string {
  // Strip extension
  const base = filename.replace(/\.jsonl$/, '');
  // Match a UUID at the end: 8-4-4-4-12 hex pattern
  const uuidMatch = base.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
  );
  if (uuidMatch) return uuidMatch[1];
  // Fallback: everything after "rollout-"
  return base.replace(/^rollout-/, '');
}

/**
 * Try to extract a user message string from a parsed JSONL event.
 *
 * Codex CLI uses several shapes depending on version:
 *   - { payload: { type: "user_message", text: "..." } }
 *   - { payload: { type: "UserMessage", text: "..." } }
 *   - { type: "user_message", text: "..." }
 *   - { type: "UserMessage", text: "..." }
 *   - { payload: { type: "user_message", content: "..." } }
 *   - { payload: { type: "user_message", message: { content: "..." } } }
 */
function extractUserMessage(obj: Record<string, unknown>): string | null {
  const candidates = [obj.payload as Record<string, unknown> | undefined, obj];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const t = c.type;
    if (t === 'user_message' || t === 'UserMessage') {
      // Direct text field
      if (typeof c.text === 'string') return c.text;
      // Content field
      if (typeof c.content === 'string') return c.content;
      // Nested message.content
      const msg = c.message as Record<string, unknown> | undefined;
      if (msg && typeof msg.content === 'string') return msg.content;
    }
  }
  return null;
}

/**
 * Check if a parsed JSONL line looks like a conversation event
 * (something we should count toward messageCount).
 */
function isConversationEvent(obj: Record<string, unknown>): boolean {
  const payload = obj.payload as Record<string, unknown> | undefined;
  const t = (payload?.type ?? obj.type) as string | undefined;
  if (!t) return false;
  // Count user messages, assistant messages, and tool outputs
  const eventTypes = new Set([
    'user_message', 'UserMessage',
    'assistant_message', 'AssistantMessage',
    'message', 'response',
    'tool_call', 'ToolCall',
    'tool_result', 'ToolResult',
  ]);
  return eventTypes.has(t);
}

/**
 * Parse a single rollout JSONL file into session metadata.
 * Only reads the first ~8KB for efficiency; counts events in that window
 * to produce an approximate message count.
 */
function parseRolloutFile(filePath: string, filename: string): CodexSessionMeta | null {
  try {
    const head = readHead(filePath, 8192);
    const stat = fs.statSync(filePath);
    const lines = head.split('\n').filter(l => l.trim().length > 0);

    if (lines.length === 0) return null;

    let id = '';
    let cwd = '';
    let timestamp = '';
    let firstPrompt = '';
    let messageCount = 0;

    for (let i = 0; i < lines.length; i++) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(lines[i]);
      } catch {
        continue;
      }

      // First valid JSON line: extract session metadata
      if (i === 0 || (!id && !cwd && !timestamp)) {
        // Session ID: try item.id, id, session_id
        const item = parsed.item as Record<string, unknown> | undefined;
        id = (
          (item?.id as string) ||
          (parsed.id as string) ||
          (parsed.session_id as string) ||
          ''
        );
        // CWD: try item.cwd, cwd
        cwd = (
          (item?.cwd as string) ||
          (parsed.cwd as string) ||
          ''
        );
        // Timestamp: try item.timestamp, timestamp, created_at, created
        timestamp = (
          (item?.timestamp as string) ||
          (parsed.timestamp as string) ||
          (item?.created_at as string) ||
          (parsed.created_at as string) ||
          (parsed.created as string) ||
          ''
        );
      }

      // Count conversation events
      if (isConversationEvent(parsed)) {
        messageCount++;
      }

      // Extract first user message
      if (!firstPrompt) {
        const msg = extractUserMessage(parsed);
        if (msg) {
          firstPrompt = msg.slice(0, 500);
        }
      }
    }

    // Fallback: extract session ID from filename
    if (!id) {
      id = sessionIdFromFilename(filename);
    }

    // Derive timestamp from filename if not found in content
    // Filename format: rollout-<timestamp>-<uuid>.jsonl
    if (!timestamp) {
      const tsMatch = filename.match(/^rollout-(\d+)/);
      if (tsMatch) {
        const epochMs = parseInt(tsMatch[1], 10);
        // Codex uses millisecond timestamps typically
        const date = new Date(epochMs > 1e12 ? epochMs : epochMs * 1000);
        if (!isNaN(date.getTime())) {
          timestamp = date.toISOString();
        }
      }
    }

    // Last resort: use file mtime for timestamp
    if (!timestamp) {
      timestamp = stat.mtime.toISOString();
    }

    return {
      id,
      cwd,
      timestamp,
      firstPrompt,
      messageCount,
      modified: stat.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Recursively collect all `rollout-*.jsonl` files under the YYYY/MM/DD
 * directory tree inside the Codex sessions directory.
 */
function collectRolloutFiles(dir: string): { filePath: string; filename: string }[] {
  const results: { filePath: string; filename: string }[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Recurse into YYYY, MM, DD subdirectories
        results.push(...collectRolloutFiles(fullPath));
      } else if (
        entry.isFile() &&
        entry.name.startsWith('rollout-') &&
        entry.name.endsWith('.jsonl')
      ) {
        results.push({ filePath: fullPath, filename: entry.name });
      }
    }
  } catch {
    // Directory unreadable or doesn't exist
  }

  return results;
}

/**
 * Scan the Codex sessions directory (~/.codex/sessions/) for all rollout
 * files and return metadata for each session.
 *
 * The directory structure is: YYYY/MM/DD/rollout-<timestamp>-<session-uuid>.jsonl
 *
 * Each file is read only partially (first 8KB) for efficiency.
 * Bad or unreadable files are silently skipped.
 */
export function scanCodexSessions(sessionsDir: string): CodexSessionMeta[] {
  if (!sessionsDir || !fs.existsSync(sessionsDir)) {
    return [];
  }

  const files = collectRolloutFiles(sessionsDir);
  const sessions: CodexSessionMeta[] = [];

  for (const { filePath, filename } of files) {
    const meta = parseRolloutFile(filePath, filename);
    if (meta) {
      sessions.push(meta);
    }
  }

  // Sort by timestamp descending (most recent first)
  sessions.sort((a, b) => {
    if (a.timestamp && b.timestamp) {
      return b.timestamp.localeCompare(a.timestamp);
    }
    return b.modified.localeCompare(a.modified);
  });

  return sessions;
}
