import { config } from '../config';
import { fullSync } from './indexer';
import { sseManager } from '../events/sse';

let watcherInitialized = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export async function initWatcher() {
  if (watcherInitialized) return;
  watcherInitialized = true;

  try {
    const chokidar = await import('chokidar');
    const watcher = chokidar.watch(config.claudeProjectsDir, {
      ignoreInitial: true,
      depth: 3,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    watcher.on('all', (event: string, filePath: string) => {
      // Only care about session-related files
      if (!filePath.endsWith('.jsonl') && !filePath.endsWith('sessions-index.json')) {
        return;
      }

      // Debounce to avoid rapid re-syncs
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

    console.log('[spaces] File watcher started on', config.claudeProjectsDir);
  } catch (err) {
    console.error('[spaces] Failed to start file watcher:', err);
  }
}
