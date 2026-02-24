import os from 'os';
import fs from 'fs';
import { getUserPaths } from '../config';
import { fullSync } from './indexer';
import { sseManager } from '../events/sse';

let watcherInitialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function initWatcher() {
  if (watcherInitialized) return;
  watcherInitialized = true;

  const processUser = os.userInfo().username;
  const paths = getUserPaths(processUser);

  const watchDirs: { dir: string; filter: (f: string) => boolean }[] = [
    {
      dir: paths.claudeProjectsDir,
      filter: (f) => f.endsWith('.jsonl') || f.endsWith('sessions-index.json'),
    },
    {
      dir: paths.codexSessionsDir,
      filter: (f) => f.endsWith('.jsonl'),
    },
    {
      dir: paths.geminiChatsBaseDir,
      filter: (f) => f.endsWith('.json') && f.includes('session-'),
    },
  ];

  try {
    const chokidar = await import('chokidar');

    for (const { dir, filter } of watchDirs) {
      if (!fs.existsSync(dir)) continue;

      const watcher = chokidar.watch(dir, {
        ignoreInitial: true,
        depth: 5,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      });

      watcher.on('all', (event: string, filePath: string) => {
        if (!filter(filePath)) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          try {
            await fullSync();
            sseManager.broadcast('sync', { type: event, file: filePath, timestamp: Date.now() });
          } catch (err) {
            console.error('[spaces] Watcher sync error:', err);
          }
        }, 1000);
      });

      console.log('[spaces] File watcher started on', dir);
    }
  } catch (err) {
    console.error('[spaces] Failed to start file watcher:', err);
  }
}
