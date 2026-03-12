import fs from 'fs';
import path from 'path';
import { getUserPaths } from '@/lib/config';
import { getCurrentUser } from '@/lib/auth';
import type { IngestionPipeline } from './pipeline';
import type { SessionMessage } from './chunker';
import { IngestionWatcher } from './watcher';

export interface BootstrapProgress {
  status: 'idle' | 'running' | 'complete' | 'error';
  totalFiles: number;
  processedFiles: number;
  totalChunks: number;
  errors: string[];
}

let _progress: BootstrapProgress = {
  status: 'idle', totalFiles: 0, processedFiles: 0, totalChunks: 0, errors: [],
};

export function getBootstrapProgress(): BootstrapProgress {
  return { ..._progress };
}

export async function runBootstrap(
  pipeline: IngestionPipeline,
  cortexDir: string,
): Promise<BootstrapProgress> {
  const username = getCurrentUser();
  const paths = getUserPaths(username);
  const watcher = new IngestionWatcher(cortexDir);

  _progress = { status: 'running', totalFiles: 0, processedFiles: 0, totalChunks: 0, errors: [] };

  const sessionFiles = findSessionFiles(paths.claudeProjectsDir);
  _progress.totalFiles = sessionFiles.length;

  for (const file of sessionFiles) {
    try {
      if (!watcher.needsSync(file.path)) {
        _progress.processedFiles++;
        continue;
      }

      const messages = parseJSONLFile(file.path);
      if (messages.length === 0) {
        _progress.processedFiles++;
        continue;
      }

      const result = await pipeline.ingest(messages, {
        sessionId: file.sessionId,
        workspaceId: null,
        agentType: 'claude',
        projectPath: file.projectPath,
      });

      _progress.totalChunks += result.chunksEmbedded;
      _progress.errors.push(...result.errors);

      watcher.markSynced(file.path, fs.statSync(file.path).size);
      _progress.processedFiles++;
    } catch (err) {
      _progress.errors.push(`Failed to process ${file.path}: ${err}`);
      _progress.processedFiles++;
    }
  }

  watcher.save();
  _progress.status = _progress.errors.length > 0 ? 'error' : 'complete';
  return { ..._progress };
}

interface SessionFile {
  path: string;
  sessionId: string;
  projectPath: string | null;
}

function findSessionFiles(claudeProjectsDir: string): SessionFile[] {
  const files: SessionFile[] = [];
  if (!fs.existsSync(claudeProjectsDir)) return files;

  const projects = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const project of projects) {
    const projectDir = path.join(claudeProjectsDir, project.name);
    const entries = fs.readdirSync(projectDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push({
          path: path.join(projectDir, entry.name),
          sessionId: entry.name.replace('.jsonl', ''),
          projectPath: decodeURIComponent(project.name),
        });
      }
    }
  }

  return files;
}

function parseJSONLFile(filePath: string): SessionMessage[] {
  const messages: SessionMessage[] = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'human' || entry.type === 'assistant') {
          const text = typeof entry.message?.content === 'string'
            ? entry.message.content
            : Array.isArray(entry.message?.content)
              ? entry.message.content
                  .filter((b: any) => b.type === 'text')
                  .map((b: any) => b.text)
                  .join('\n')
              : '';

          if (text) {
            messages.push({
              role: entry.type,
              content: text,
              timestamp: entry.timestamp || new Date().toISOString(),
              hasToolUse: Array.isArray(entry.message?.content) &&
                entry.message.content.some((b: any) => b.type === 'tool_use'),
            });
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* skip unreadable files */ }
  return messages;
}
