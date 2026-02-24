import fs from 'fs';
import path from 'path';

export interface GeminiSessionMeta {
  sessionId: string;
  projectSlug: string;
  projectPath: string;
  startTime: string;
  lastUpdated: string;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  fullPath: string;
}

/**
 * Safely read a directory, returning an empty array on any error.
 */
function safeReaddir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

/**
 * Check if a path is a directory, returning false on any error.
 */
function isDir(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read projects.json to build a slug -> project path map.
 * Returns an empty map if the file doesn't exist or can't be parsed.
 *
 * Expected format: an object mapping project paths to objects with an `id` field
 * (the slug), e.g. { "/home/user/myproject": { "id": "myproject-abc123" } }
 */
function loadProjectsRegistry(registryPath: string): Map<string, string> {
  const slugToPath = new Map<string, string>();

  try {
    if (!fs.existsSync(registryPath)) {
      return slugToPath;
    }
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const registry = JSON.parse(raw);

    if (typeof registry !== 'object' || registry === null) {
      return slugToPath;
    }

    // The registry maps project paths to { id: slug, ... }
    for (const [projectPath, entry] of Object.entries(registry)) {
      if (entry && typeof entry === 'object' && 'id' in entry) {
        const slug = (entry as { id: string }).id;
        if (typeof slug === 'string') {
          slugToPath.set(slug, projectPath);
        }
      }
    }
  } catch {
    // Corrupt or unreadable file -- return empty map
  }

  return slugToPath;
}

/**
 * Extract the text from a Gemini message's content field.
 * Gemini messages may have:
 *   - content as a plain string
 *   - content as an object with a `parts` array, each part having a `text` field
 *   - content as an array of parts directly
 */
function extractContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (content && typeof content === 'object') {
    // content.parts array format
    let parts: unknown[] | undefined;

    if (Array.isArray(content)) {
      parts = content;
    } else if ('parts' in content && Array.isArray((content as { parts: unknown }).parts)) {
      parts = (content as { parts: unknown[] }).parts;
    }

    if (parts) {
      const texts: string[] = [];
      for (const part of parts) {
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text: unknown }).text;
          if (typeof text === 'string') {
            texts.push(text);
          }
        }
      }
      return texts.join('\n');
    }
  }

  return '';
}

/**
 * Parse a single Gemini session JSON file and extract metadata.
 * Returns null if the file can't be parsed or has no messages.
 */
function parseSessionFile(
  filePath: string,
  projectSlug: string,
  slugToPath: Map<string, string>,
): GeminiSessionMeta | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const record = JSON.parse(raw);

    if (typeof record !== 'object' || record === null) {
      return null;
    }

    const sessionId: string = record.sessionId || path.basename(filePath, '.json');
    const startTime: string = record.startTime || '';
    const lastUpdated: string = record.lastUpdated || '';
    const summary: string = record.summary || '';
    const messages: unknown[] = Array.isArray(record.messages) ? record.messages : [];

    // Count conversation messages and find the first user prompt
    let messageCount = 0;
    let firstPrompt = '';

    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;

      const role = (msg as { role?: string }).role;
      if (role === 'user' || role === 'model' || role === 'assistant') {
        messageCount++;
      }

      if (role === 'user' && !firstPrompt) {
        const content = (msg as { content?: unknown }).content;
        const text = extractContentText(content);
        if (text) {
          firstPrompt = text.trim().slice(0, 200);
        }
      }
    }

    const projectPath = slugToPath.get(projectSlug) || '';

    return {
      sessionId,
      projectSlug,
      projectPath,
      startTime,
      lastUpdated,
      firstPrompt,
      summary,
      messageCount,
      fullPath: filePath,
    };
  } catch {
    return null;
  }
}

/**
 * Scan Gemini CLI session files and return metadata for each session.
 *
 * Walks ~/.gemini/tmp/<project-slug>/chats/ for session-*.json files,
 * optionally enriching project paths from the projects.json registry.
 *
 * @param geminiChatsBaseDir  Path to ~/.gemini/tmp/
 * @param projectsRegistryPath  Path to ~/.gemini/projects.json
 */
export function scanGeminiSessions(
  geminiChatsBaseDir: string,
  projectsRegistryPath: string,
): GeminiSessionMeta[] {
  const slugToPath = loadProjectsRegistry(projectsRegistryPath);
  const results: GeminiSessionMeta[] = [];

  // Each entry in the base dir is a project slug directory
  const projectSlugs = safeReaddir(geminiChatsBaseDir);

  for (const slug of projectSlugs) {
    const projectDir = path.join(geminiChatsBaseDir, slug);
    if (!isDir(projectDir)) continue;

    const chatsDir = path.join(projectDir, 'chats');
    if (!isDir(chatsDir)) continue;

    const files = safeReaddir(chatsDir);

    for (const file of files) {
      if (!file.startsWith('session-') || !file.endsWith('.json')) continue;

      const filePath = path.join(chatsDir, file);
      const meta = parseSessionFile(filePath, slug, slugToPath);
      if (meta) {
        results.push(meta);
      }
    }
  }

  return results;
}
