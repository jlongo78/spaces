import { getDb } from './schema';
import { fullSync, enrichMissingSessions, buildFtsIndex } from '../sync/indexer';

let initialized = false;
let syncing = false;

export async function ensureInitialized() {
  if (initialized) return;

  // This just ensures the DB schema exists
  getDb();
  initialized = true;

  // Run initial sync if needed
  if (!syncing) {
    syncing = true;
    try {
      const result = await fullSync();
      console.log(`[spaces] Synced ${result.projects} projects, ${result.sessions} sessions`);

      // Enrich sessions without metadata (background)
      const enriched = await enrichMissingSessions();
      if (enriched > 0) {
        console.log(`[spaces] Enriched ${enriched} sessions from JSONL`);
      }

      // Build FTS index (background, non-blocking)
      buildFtsIndex((done, total) => {
        if (done % 10 === 0) {
          console.log(`[spaces] FTS indexing: ${done}/${total}`);
        }
      }).then(indexed => {
        if (indexed > 0) {
          console.log(`[spaces] FTS indexed ${indexed} sessions`);
        }
      }).catch(err => {
        console.error('[spaces] FTS indexing error:', err);
      });
    } catch (err) {
      console.error('[spaces] Sync error:', err);
    } finally {
      syncing = false;
    }
  }
}
