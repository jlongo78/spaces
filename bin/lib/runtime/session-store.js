// bin/lib/runtime/session-store.js
'use strict';

const fs = require('fs');

// "SPCS": the mark the web app puts on spaces.db (src/lib/db/ownership.ts).
// Another macOS app also called "Spaces" keeps a spaces.db of its own in
// ~/.spaces (issue #38); writing our rows into its tables fails with
// "table workspaces has no column named name", so say what is wrong instead.
const SPACES_APPLICATION_ID = 0x53504353;

/** Why `db` is not ours, or null when it is (or may be: unmarked but ours-shaped). */
function foreignReason(db) {
  const id = db.pragma('application_id', { simple: true });
  if (id === SPACES_APPLICATION_ID) return null;
  if (id !== 0) return `application_id ${id}`;
  const cols = db.prepare('PRAGMA table_info(workspaces)').all();
  if (cols.length > 0 && !cols.some(c => c.name === 'name')) return 'no workspaces.name column';
  return null;
}

/**
 * Read-write access to the session database. Distinct from the runtime's
 * read-only snapshot handle: creating panes and workspaces has to write.
 * Every method returns {ok:...} — a caller in a dispatch switch must never
 * have to catch.
 */
function createSessionStore({ dbPath } = {}) {
  let db = null;
  // Once close() runs, the store is permanently done: open()/withDb() must
  // never resurrect a connection. Without this flag, close() only nulled
  // `db`, so the very next method call looked exactly like "not yet opened"
  // and silently reopened — leaking a handle that (on Windows) blocks
  // deleting/renaming the underlying DB file until a second close() call.
  let closed = false;
  let openError = null;

  function open() {
    if (closed) return null;
    if (db) return db;
    if (!dbPath || !fs.existsSync(dbPath)) return null;
    try {
      const Database = require('better-sqlite3');
      const d = new Database(dbPath);
      const reason = foreignReason(d);
      if (reason) {
        d.close();
        openError = `${dbPath} belongs to another application (${reason}). ` +
          'Spaces will not change it. Move or rename that file, then start Spaces again.';
        return null;
      }
      db = d;
      // NOTE: panes.workspace_id has NO declared FK in production (it was added
      // via a bare ALTER TABLE ADD COLUMN), so closeWorkspace() below deletes
      // panes explicitly rather than relying on a cascade that doesn't exist
      // for that table. This pragma is kept anyway because other tables
      // (workspace_sessions, workspace_todos) DO declare real
      // `ON DELETE CASCADE` FKs, and it's harmless here.
      db.pragma('foreign_keys = ON');
      return db;
    } catch {
      return null;
    }
  }

  function withDb(fn) {
    if (closed) return { ok: false, error: 'session store is closed' };
    const d = open();
    if (!d) return { ok: false, error: openError || 'session database unavailable' };
    try {
      return fn(d);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function workspaceExists(d, id) {
    return d.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(id) !== undefined;
  }

  return {
    /**
     * Runs `fn` against this store's own connection. The db watcher reads
     * `PRAGMA data_version` through it, which only moves for commits made by
     * *other* connections — so this runtime's own writes never look like an
     * outside change.
     */
    withConnection(fn) {
      return withDb(fn);
    },

    createWorkspace({ name, color = null }) {
      return withDb(d => {
        const info = d
          .prepare('INSERT INTO workspaces (name, description, color) VALUES (?, ?, ?)')
          .run(name, null, color);
        return { ok: true, id: Number(info.lastInsertRowid) };
      });
    },

    updateWorkspace(id, fields = {}) {
      const sets = [];
      const values = [];
      if (Object.prototype.hasOwnProperty.call(fields, 'name')) { sets.push('name = ?'); values.push(fields.name); }
      if (Object.prototype.hasOwnProperty.call(fields, 'color')) { sets.push('color = ?'); values.push(fields.color); }
      if (!sets.length) return { ok: false, error: 'no fields to update' };
      return withDb(d => {
        if (!workspaceExists(d, id)) return { ok: false, error: `no workspace ${id}` };
        d.prepare(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
        return { ok: true };
      });
    },

    /**
     * Updates a pane's user-visible fields. Mirrors updateWorkspace: only the
     * keys actually present are written, so setting a title never clears a
     * color and vice versa.
     *
     * `title` and `color` are NOT NULL in production (src/lib/db/schema.ts),
     * so neither is ever written as null — the caller is expected to have
     * validated them, and pane.update does.
     */
    updatePane(paneId, fields = {}) {
      const sets = [];
      const values = [];
      if (Object.prototype.hasOwnProperty.call(fields, 'title')) { sets.push('title = ?'); values.push(fields.title); }
      if (Object.prototype.hasOwnProperty.call(fields, 'color')) { sets.push('color = ?'); values.push(fields.color); }
      if (!sets.length) return { ok: false, error: 'no fields to update' };
      return withDb(d => {
        const row = d.prepare('SELECT id FROM panes WHERE id = ?').get(paneId);
        if (!row) return { ok: false, error: `no pane ${paneId}` };
        d.prepare(`UPDATE panes SET ${sets.join(', ')} WHERE id = ?`).run(...values, paneId);
        return { ok: true };
      });
    },

    closeWorkspace(id) {
      return withDb(d => {
        if (!workspaceExists(d, id)) return { ok: false, error: `no workspace ${id}` };
        // No FK cascade exists on panes.workspace_id in production, so the
        // panes belonging to this workspace are deleted explicitly, in the
        // same transaction as the workspace row, rather than trusted to a
        // cascade that isn't there. The deleted ids are returned so a
        // caller (a later task) can kill the corresponding live PTYs —
        // impossible to recover once the rows are gone.
        const closeTxn = d.transaction((wsId) => {
          const deletedPaneIds = d
            .prepare('SELECT id FROM panes WHERE workspace_id = ?')
            .all(wsId)
            .map(row => row.id);
          d.prepare('DELETE FROM panes WHERE workspace_id = ?').run(wsId);
          d.prepare('DELETE FROM workspaces WHERE id = ?').run(wsId);
          return deletedPaneIds;
        });
        return { ok: true, deletedPaneIds: closeTxn(id) };
      });
    },

    createPane({ paneId, workspaceId, agentType, cwd, title }) {
      return withDb(d => {
        if (d.prepare('SELECT 1 FROM panes WHERE id = ?').get(paneId)) {
          return { ok: false, error: `pane ${paneId} already exists` };
        }
        if (!workspaceExists(d, workspaceId)) return { ok: false, error: `no workspace ${workspaceId}` };
        const next = d
          .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM panes WHERE workspace_id = ?')
          .get(workspaceId).n;
        // title/color are NOT NULL in production (src/lib/db/schema.ts) with
        // no way to pass color through this interface — fall back to the
        // same literal defaults the schema declares rather than inserting
        // NULL, which the real table would reject.
        d.prepare(
          'INSERT INTO panes (id, title, color, cwd, agent_type, sort_order, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(paneId, title ?? 'Terminal', '#6366f1', cwd ?? null, agentType ?? 'shell', next, workspaceId);
        return { ok: true };
      });
    },

    /** The stored launch details of one pane, or null when there is no such row. */
    getPane(paneId) {
      const res = withDb(d => {
        const cols = new Set(d.prepare('PRAGMA table_info(panes)').all().map(c => c.name));
        const optional = ['claude_session_id', 'custom_command'].filter(c => cols.has(c));
        const row = d.prepare(`SELECT ${['id', 'workspace_id', 'agent_type', 'cwd', ...optional].join(', ')} FROM panes WHERE id = ?`).get(paneId);
        return { ok: true, row: row || null };
      });
      return res.ok ? res.row : null;
    },

    /** Records the Claude conversation a pane is running, for pane.restart to resume. */
    setClaudeSession(paneId, sessionId) {
      return withDb(d => {
        const info = d.prepare('UPDATE panes SET claude_session_id = ? WHERE id = ?').run(sessionId, paneId);
        return info.changes ? { ok: true } : { ok: false, error: `no pane ${paneId}` };
      });
    },

    deletePane(paneId) {
      return withDb(d => {
        const info = d.prepare('DELETE FROM panes WHERE id = ?').run(paneId);
        if (!info.changes) return { ok: false, error: `no pane ${paneId}` };
        return { ok: true };
      });
    },

    movePane(paneId, workspaceId) {
      return withDb(d => {
        if (!d.prepare('SELECT 1 FROM panes WHERE id = ?').get(paneId)) {
          return { ok: false, error: `no pane ${paneId}` };
        }
        if (!workspaceExists(d, workspaceId)) return { ok: false, error: `no workspace ${workspaceId}` };
        d.prepare('UPDATE panes SET workspace_id = ? WHERE id = ?').run(workspaceId, paneId);
        return { ok: true };
      });
    },

    close() {
      // Idempotent and terminal: a second call just re-confirms `closed`
      // (already true, already null `db`) rather than throwing or reopening.
      closed = true;
      if (db) { try { db.close(); } catch { /* already closed */ } db = null; }
    },
  };
}

module.exports = { createSessionStore };
