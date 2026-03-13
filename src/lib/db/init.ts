import { getDb } from './schema';
import { fullSync, enrichMissingSessions, buildFtsIndex } from '../sync/indexer';
import { getCurrentUser } from '../auth';
import { getTeams } from '../teams';

const initialized = new Set<string>();
const syncing = new Set<string>();
let teamsInitialized = false;
let lastFtsRun = 0;
const FTS_INTERVAL_MS = 5 * 60 * 1000; // Re-check for unindexed sessions every 5 minutes

export async function ensureInitialized() {
  const username = getCurrentUser();

  if (initialized.has(username)) {
    // Periodically re-run FTS indexing for newly synced sessions
    const now = Date.now();
    if (now - lastFtsRun > FTS_INTERVAL_MS) {
      lastFtsRun = now;
      buildFtsIndex().catch(() => {});
    }
    return;
  }

  // This just ensures the DB schema exists
  getDb();
  initialized.add(username);

  // Initialize @spaces/teams if installed (once globally)
  if (!teamsInitialized) {
    teamsInitialized = true;
    const teams = getTeams();
    if (teams) {
      const { sseManager } = await import('../events/sse');
      teams.init({ getDb, sseManager });
    }
  }

  // Run initial sync if needed
  if (!syncing.has(username)) {
    syncing.add(username);
    try {
      const result = await fullSync();
      console.log(`[spaces:${username}] Synced ${result.projects} projects, ${result.sessions} sessions`);

      // Enrich sessions without metadata (background)
      const enriched = await enrichMissingSessions();
      if (enriched > 0) {
        console.log(`[spaces:${username}] Enriched ${enriched} sessions from JSONL`);
      }

      // Build FTS index (background, non-blocking)
      lastFtsRun = Date.now();
      buildFtsIndex((done, total) => {
        if (done > 0 && done % 10 === 0) {
          console.log(`[spaces:${username}] FTS indexing: ${done}/${total}`);
        }
      }).then(indexed => {
        if (indexed > 0) {
          console.log(`[spaces:${username}] FTS indexed ${indexed} sessions`);
        }
      }).catch(err => {
        console.error(`[spaces:${username}] FTS indexing error:`, err);
      });
    } catch (err) {
      console.error(`[spaces:${username}] Sync error:`, err);
    } finally {
      syncing.delete(username);
    }
  }
}
