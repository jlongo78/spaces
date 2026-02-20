import { getDb } from './schema';
import { fullSync, enrichMissingSessions, buildFtsIndex } from '../sync/indexer';
import { getCurrentUser } from '../auth';

const initialized = new Set<string>();
const syncing = new Set<string>();

export async function ensureInitialized() {
  const username = getCurrentUser();

  if (initialized.has(username)) return;

  // This just ensures the DB schema exists
  getDb();
  initialized.add(username);

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
      buildFtsIndex((done, total) => {
        if (done % 10 === 0) {
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
