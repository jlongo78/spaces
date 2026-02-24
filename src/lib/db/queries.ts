import crypto from 'crypto';
import { getDb } from './schema';
import type { SessionWithMeta, Project, Workspace, Tag, SearchResult } from '@/types/claude';

// ─── Projects ───────────────────────────────────────────────

export function upsertProject(project: { id: string; name: string; path: string; claudePath: string; agentType?: string }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO projects (id, name, path, claude_path, agent_path, agent_type)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, path=excluded.path, claude_path=excluded.claude_path, agent_path=excluded.agent_path, agent_type=excluded.agent_type
  `).run(project.id, project.name, project.path, project.claudePath, project.claudePath, project.agentType || 'claude');
}

export function getAllProjects(): Project[] {
  const db = getDb();
  return db.prepare(`
    SELECT p.id, p.name, p.path, p.claude_path as claudePath,
      p.agent_type as agentType,
      COUNT(s.id) as sessionCount,
      MAX(s.modified) as lastActivity
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    GROUP BY p.id
    ORDER BY lastActivity DESC
  `).all() as Project[];
}

// ─── Sessions ───────────────────────────────────────────────

export function upsertSession(session: {
  id: string;
  sessionId: string;
  projectId: string;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  fullPath: string;
  agentType?: string;
}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sessions (id, session_id, project_id, first_prompt, summary, message_count, created, modified, git_branch, project_path, full_path, agent_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      first_prompt=excluded.first_prompt,
      summary=excluded.summary,
      message_count=excluded.message_count,
      modified=excluded.modified,
      git_branch=excluded.git_branch,
      full_path=excluded.full_path,
      agent_type=excluded.agent_type
  `).run(
    session.id, session.sessionId, session.projectId,
    session.firstPrompt, session.summary, session.messageCount,
    session.created, session.modified, session.gitBranch,
    session.projectPath, session.fullPath, session.agentType || 'claude'
  );
}

interface SessionQueryParams {
  projectId?: string;
  projectPath?: string;
  starred?: boolean;
  tagId?: number;
  search?: string;
  agentType?: string;
  sortBy?: string;
  sortDir?: string;
  offset?: number;
  limit?: number;
}

export function getSessions(params: SessionQueryParams = {}): { sessions: SessionWithMeta[]; total: number } {
  const db = getDb();
  const {
    projectId,
    projectPath,
    starred,
    tagId,
    search,
    sortBy = 'modified',
    sortDir = 'DESC',
    offset = 0,
    limit = 50,
  } = params;

  const where: string[] = [];
  const queryParams: (string | number)[] = [];

  if (projectId) {
    where.push('s.project_id = ?');
    queryParams.push(projectId);
  }
  if (projectPath) {
    where.push('s.project_path = ?');
    queryParams.push(projectPath);
  }
  if (starred !== undefined) {
    where.push('s.starred = ?');
    queryParams.push(starred ? 1 : 0);
  }
  if (tagId) {
    where.push('EXISTS (SELECT 1 FROM session_tags st WHERE st.session_id = s.id AND st.tag_id = ?)');
    queryParams.push(tagId);
  }
  if (search) {
    where.push('(s.first_prompt LIKE ? OR s.summary LIKE ? OR s.custom_name LIKE ?)');
    const pattern = `%${search}%`;
    queryParams.push(pattern, pattern, pattern);
  }
  if (params.agentType) {
    where.push('s.agent_type = ?');
    queryParams.push(params.agentType);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const allowedSorts: Record<string, string> = {
    created: 's.created',
    modified: 's.modified',
    messages: 's.message_count',
    name: "COALESCE(s.custom_name, s.summary, s.first_prompt)",
  };
  const sortColumn = allowedSorts[sortBy] || 's.modified';
  const direction = sortDir === 'ASC' ? 'ASC' : 'DESC';

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM sessions s ${whereClause}`).get(...queryParams) as { total: number };

  const rows = db.prepare(`
    SELECT s.id, s.session_id as sessionId, s.project_id as projectId,
      p.name as projectName, s.first_prompt as firstPrompt,
      s.summary, s.message_count as messageCount,
      s.created, s.modified, s.git_branch as gitBranch,
      s.project_path as projectPath, s.full_path as fullPath,
      s.starred, s.custom_name as customName, s.notes,
      s.agent_type as agentType
    FROM sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    ${whereClause}
    ORDER BY ${sortColumn} ${direction}
    LIMIT ? OFFSET ?
  `).all(...queryParams, limit, offset) as SessionWithMeta[];

  // Fetch tags and workspaces for each session
  const tagStmt = db.prepare(`
    SELECT t.name FROM tags t
    JOIN session_tags st ON st.tag_id = t.id
    WHERE st.session_id = ?
  `);
  const wsStmt = db.prepare(`
    SELECT w.id, w.name, w.color FROM workspaces w
    JOIN workspace_sessions ws ON ws.workspace_id = w.id
    WHERE ws.session_id = ?
  `);

  for (const row of rows) {
    const tags = tagStmt.all(row.id) as { name: string }[];
    row.tags = tags.map(t => t.name);
    row.workspaces = wsStmt.all(row.id) as { id: number; name: string; color: string }[];
    row.starred = !!row.starred;
  }

  return { sessions: rows, total: countRow.total };
}

export function getSessionById(id: string): SessionWithMeta | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT s.id, s.session_id as sessionId, s.project_id as projectId,
      p.name as projectName, s.first_prompt as firstPrompt,
      s.summary, s.message_count as messageCount,
      s.created, s.modified, s.git_branch as gitBranch,
      s.project_path as projectPath, s.full_path as fullPath,
      s.starred, s.custom_name as customName, s.notes,
      s.agent_type as agentType
    FROM sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE s.id = ? OR s.session_id = ?
  `).get(id, id) as SessionWithMeta | undefined;

  if (!row) return null;

  const tags = db.prepare(`
    SELECT t.name FROM tags t
    JOIN session_tags st ON st.tag_id = t.id
    WHERE st.session_id = ?
  `).all(row.id) as { name: string }[];

  row.tags = tags.map(t => t.name);
  row.starred = !!row.starred;

  return row;
}

export function toggleStar(sessionId: string): boolean {
  const db = getDb();
  const current = db.prepare('SELECT starred FROM sessions WHERE id = ? OR session_id = ?').get(sessionId, sessionId) as { starred: number } | undefined;
  if (!current) return false;
  const newValue = current.starred ? 0 : 1;
  db.prepare('UPDATE sessions SET starred = ? WHERE id = ? OR session_id = ?').run(newValue, sessionId, sessionId);
  return !!newValue;
}

export function updateSessionNotes(sessionId: string, notes: string) {
  const db = getDb();
  db.prepare('UPDATE sessions SET notes = ? WHERE id = ? OR session_id = ?').run(notes, sessionId, sessionId);
}

// ─── Workspaces ─────────────────────────────────────────────

export function createWorkspace(name: string, description?: string, color?: string): Workspace {
  const db = getDb();
  const result = db.prepare('INSERT INTO workspaces (name, description, color) VALUES (?, ?, ?)').run(
    name, description || '', color || '#6366f1'
  );
  return { id: Number(result.lastInsertRowid), name, description: description || '', color: color || '#6366f1', created: new Date().toISOString() };
}

export function getAllWorkspaces(): Workspace[] {
  const db = getDb();
  return db.prepare(`
    SELECT w.*, COUNT(ws.session_id) as sessionCount
    FROM workspaces w
    LEFT JOIN workspace_sessions ws ON ws.workspace_id = w.id
    GROUP BY w.id
    ORDER BY w.created DESC
  `).all() as Workspace[];
}

export function addSessionToWorkspace(workspaceId: number, sessionId: string) {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO workspace_sessions (workspace_id, session_id) VALUES (?, ?)').run(workspaceId, sessionId);
}

export function removeSessionFromWorkspace(workspaceId: number, sessionId: string) {
  const db = getDb();
  db.prepare('DELETE FROM workspace_sessions WHERE workspace_id = ? AND session_id = ?').run(workspaceId, sessionId);
}

// ─── Tags ───────────────────────────────────────────────────

export function createTag(name: string, color?: string): Tag {
  const db = getDb();
  const result = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)').run(name, color || '#8b5cf6');
  return { id: Number(result.lastInsertRowid), name, color: color || '#8b5cf6' };
}

export function getAllTags(): Tag[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tags ORDER BY name').all() as Tag[];
}

export function addTagToSession(sessionId: string, tagName: string) {
  const db = getDb();
  let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number } | undefined;
  if (!tag) {
    const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
    tag = { id: Number(result.lastInsertRowid) };
  }
  db.prepare('INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)').run(sessionId, tag.id);
}

export function removeTagFromSession(sessionId: string, tagId: number) {
  const db = getDb();
  db.prepare('DELETE FROM session_tags WHERE session_id = ? AND tag_id = ?').run(sessionId, tagId);
}

export function removeTagFromSessionByName(sessionId: string, tagName: string) {
  const db = getDb();
  const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number } | undefined;
  if (tag) {
    db.prepare('DELETE FROM session_tags WHERE session_id = ? AND tag_id = ?').run(sessionId, tag.id);
  }
}

export function deleteTag(tagId: number) {
  const db = getDb();
  db.prepare('DELETE FROM session_tags WHERE tag_id = ?').run(tagId);
  db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
}

export function updateTagColor(tagId: number, color: string) {
  const db = getDb();
  db.prepare('UPDATE tags SET color = ? WHERE id = ?').run(color, tagId);
}

export function getSessionTags(sessionId: string): Tag[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.id, t.name, t.color FROM tags t
    JOIN session_tags st ON st.tag_id = t.id
    WHERE st.session_id = ?
    ORDER BY t.name
  `).all(sessionId) as Tag[];
}

export function renameSession(sessionId: string, customName: string) {
  const db = getDb();
  db.prepare('UPDATE sessions SET custom_name = ? WHERE id = ? OR session_id = ?').run(customName || null, sessionId, sessionId);
}

// ─── Workspace Extras ───────────────────────────────────────

export function deleteWorkspace(workspaceId: number) {
  const db = getDb();
  db.prepare('DELETE FROM workspace_sessions WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
}

export function updateWorkspace(workspaceId: number, data: { name?: string; description?: string; color?: string }) {
  const db = getDb();
  if (data.name !== undefined) db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(data.name, workspaceId);
  if (data.description !== undefined) db.prepare('UPDATE workspaces SET description = ? WHERE id = ?').run(data.description, workspaceId);
  if (data.color !== undefined) db.prepare('UPDATE workspaces SET color = ? WHERE id = ?').run(data.color, workspaceId);
}

export function getWorkspacesForSession(sessionId: string): { id: number; name: string; color: string }[] {
  const db = getDb();
  // Check workspace_sessions first (local sessions)
  const fromWs = db.prepare(`
    SELECT w.id, w.name, w.color FROM workspaces w
    JOIN workspace_sessions ws ON ws.workspace_id = w.id
    WHERE ws.session_id = ?
  `).all(sessionId) as { id: number; name: string; color: string }[];
  if (fromWs.length > 0) return fromWs;
  // Fallback: check panes table (remote sessions stored via pane only)
  return db.prepare(`
    SELECT DISTINCT w.id, w.name, w.color FROM workspaces w
    JOIN panes p ON p.workspace_id = w.id
    WHERE p.claude_session_id = ?
  `).all(sessionId) as { id: number; name: string; color: string }[];
}

export function getWorkspaceSessions(workspaceId: number): SessionWithMeta[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT s.id, s.session_id as sessionId, s.project_id as projectId,
      p.name as projectName, s.first_prompt as firstPrompt,
      s.summary, s.message_count as messageCount,
      s.created, s.modified, s.git_branch as gitBranch,
      s.project_path as projectPath, s.full_path as fullPath,
      s.starred, s.custom_name as customName, s.notes,
      s.agent_type as agentType
    FROM sessions s
    JOIN workspace_sessions ws ON ws.session_id = s.id
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE ws.workspace_id = ?
    ORDER BY s.modified DESC
  `).all(workspaceId) as SessionWithMeta[];

  const tagStmt = db.prepare('SELECT t.name FROM tags t JOIN session_tags st ON st.tag_id = t.id WHERE st.session_id = ?');
  for (const row of rows) {
    row.tags = (tagStmt.all(row.id) as { name: string }[]).map(t => t.name);
    row.starred = !!row.starred;
  }
  return rows;
}

export function getSessionWorkspaces(sessionId: string): Workspace[] {
  const db = getDb();
  return db.prepare(`
    SELECT w.id, w.name, w.description, w.color, w.created
    FROM workspaces w
    JOIN workspace_sessions ws ON ws.workspace_id = w.id
    WHERE ws.session_id = ?
  `).all(sessionId) as Workspace[];
}

// ─── Bulk Operations ────────────────────────────────────────

export function bulkAddTag(sessionIds: string[], tagName: string) {
  const db = getDb();
  let tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as { id: number } | undefined;
  if (!tag) {
    const result = db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName);
    tag = { id: Number(result.lastInsertRowid) };
  }
  const stmt = db.prepare('INSERT OR IGNORE INTO session_tags (session_id, tag_id) VALUES (?, ?)');
  const run = db.transaction(() => {
    for (const id of sessionIds) stmt.run(id, tag!.id);
  });
  run();
}

export function bulkAddToWorkspace(sessionIds: string[], workspaceId: number) {
  const db = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO workspace_sessions (workspace_id, session_id) VALUES (?, ?)');
  const run = db.transaction(() => {
    for (const id of sessionIds) stmt.run(workspaceId, id);
  });
  run();
}

export function bulkStar(sessionIds: string[], starred: boolean) {
  const db = getDb();
  const stmt = db.prepare('UPDATE sessions SET starred = ? WHERE id = ?');
  const run = db.transaction(() => {
    for (const id of sessionIds) stmt.run(starred ? 1 : 0, id);
  });
  run();
}

// ─── FTS Search ─────────────────────────────────────────────

export function upsertFtsContent(sessionId: string, content: string) {
  const db = getDb();
  db.prepare('DELETE FROM sessions_fts WHERE session_id = ?').run(sessionId);
  db.prepare('INSERT INTO sessions_fts (session_id, content) VALUES (?, ?)').run(sessionId, content);
}

export function searchSessions(query: string, params: { projectId?: string; limit?: number; offset?: number } = {}): SearchResult[] {
  const db = getDb();
  const { projectId, limit = 20, offset = 0 } = params;

  let sql = `
    SELECT f.session_id as sessionId, snippet(sessions_fts, 1, '<mark>', '</mark>', '...', 40) as snippet,
      rank, p.name as projectName, s.first_prompt as firstPrompt, s.created
    FROM sessions_fts f
    JOIN sessions s ON s.id = f.session_id OR s.session_id = f.session_id
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE sessions_fts MATCH ?
  `;
  const queryParams: (string | number)[] = [query];

  if (projectId) {
    sql += ' AND s.project_id = ?';
    queryParams.push(projectId);
  }

  sql += ' ORDER BY rank LIMIT ? OFFSET ?';
  queryParams.push(limit, offset);

  try {
    return db.prepare(sql).all(...queryParams) as SearchResult[];
  } catch {
    // Fallback to LIKE search if FTS fails
    return db.prepare(`
      SELECT s.id as sessionId, substr(s.first_prompt, 1, 200) as snippet,
        0 as rank, p.name as projectName, s.first_prompt as firstPrompt, s.created
      FROM sessions s
      LEFT JOIN projects p ON p.id = s.project_id
      WHERE s.first_prompt LIKE ? OR s.summary LIKE ?
      LIMIT ? OFFSET ?
    `).all(`%${query}%`, `%${query}%`, limit, offset) as SearchResult[];
  }
}

// ─── Sync State ─────────────────────────────────────────────

export function getSyncState(filePath: string): { mtime: number; byteOffset: number } | null {
  const db = getDb();
  const row = db.prepare('SELECT mtime, byte_offset as byteOffset FROM sync_state WHERE file_path = ?').get(filePath) as { mtime: number; byteOffset: number } | undefined;
  return row || null;
}

export function updateSyncState(filePath: string, mtime: number, byteOffset: number) {
  const db = getDb();
  db.prepare(`
    INSERT INTO sync_state (file_path, mtime, byte_offset, last_synced)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(file_path) DO UPDATE SET mtime=excluded.mtime, byte_offset=excluded.byte_offset, last_synced=datetime('now')
  `).run(filePath, mtime, byteOffset);
}

// ─── Panes ─────────────────────────────────────────────────

export interface PaneData {
  id: string;
  title: string;
  color: string;
  cwd: string;
  claudeSessionId: string | null;
  agentType: string;
  customCommand: string | null;
  gridCol: number;
  gridRow: number;
  sortOrder: number;
  shell: string | null;
  created: string;
  workspaceId: number | null;
  isPopout: boolean;
  winX: number | null;
  winY: number | null;
  winWidth: number | null;
  winHeight: number | null;
  nodeId: string | null;
}

const PANE_SELECT = `
  id, title, color, cwd, claude_session_id as claudeSessionId,
  agent_type as agentType, custom_command as customCommand,
  grid_col as gridCol, grid_row as gridRow, sort_order as sortOrder,
  shell, created, workspace_id as workspaceId,
  is_popout as isPopout, win_x as winX, win_y as winY,
  win_width as winWidth, win_height as winHeight,
  node_id as nodeId
`;

function mapPane(row: any): PaneData {
  return { ...row, isPopout: !!row.isPopout };
}

export function getPanesByWorkspace(workspaceId: number): PaneData[] {
  const db = getDb();
  const rows = db.prepare(`SELECT ${PANE_SELECT} FROM panes WHERE workspace_id = ? ORDER BY sort_order, created`).all(workspaceId);
  return rows.map(mapPane) as PaneData[];
}

export function getAllPanes(): PaneData[] {
  const db = getDb();
  const rows = db.prepare(`SELECT ${PANE_SELECT} FROM panes ORDER BY sort_order, created`).all();
  return rows.map(mapPane) as PaneData[];
}

export function getActivePanes(): PaneData[] {
  const db = getDb();
  const activeWs = db.prepare('SELECT id FROM workspaces WHERE is_active = 1').get() as { id: number } | undefined;
  if (!activeWs) return [];
  return getPanesByWorkspace(activeWs.id);
}

export function createPane(pane: {
  id: string;
  title: string;
  color: string;
  cwd: string;
  claudeSessionId?: string;
  agentType?: string;
  customCommand?: string;
  sortOrder?: number;
  workspaceId?: number;
  nodeId?: string;
}): PaneData {
  const db = getDb();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM panes').get() as { m: number | null };
  const order = pane.sortOrder ?? ((maxOrder.m ?? -1) + 1);

  // Default to active workspace if not specified
  let wsId = pane.workspaceId;
  if (wsId === undefined) {
    const activeWs = db.prepare('SELECT id FROM workspaces WHERE is_active = 1').get() as { id: number } | undefined;
    wsId = activeWs?.id;
  }

  db.prepare(`
    INSERT INTO panes (id, title, color, cwd, claude_session_id, agent_type, custom_command, sort_order, workspace_id, node_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(pane.id, pane.title, pane.color, pane.cwd, pane.claudeSessionId || null, pane.agentType || 'shell', pane.customCommand || null, order, wsId || null, pane.nodeId || null);

  return getPaneById(pane.id)!;
}

export function getPaneById(id: string): PaneData | null {
  const db = getDb();
  const row = db.prepare(`SELECT ${PANE_SELECT} FROM panes WHERE id = ?`).get(id) as any | null;
  return row ? mapPane(row) : null;
}

export function updatePane(id: string, data: {
  title?: string;
  color?: string;
  cwd?: string;
  claudeSessionId?: string | null;
  agentType?: string;
  customCommand?: string | null;
  gridCol?: number;
  gridRow?: number;
  sortOrder?: number;
  workspaceId?: number | null;
  isPopout?: boolean;
  winX?: number | null;
  winY?: number | null;
  winWidth?: number | null;
  winHeight?: number | null;
}) {
  const db = getDb();
  const sets: string[] = [];
  const vals: any[] = [];

  if (data.title !== undefined) { sets.push('title = ?'); vals.push(data.title); }
  if (data.color !== undefined) { sets.push('color = ?'); vals.push(data.color); }
  if (data.cwd !== undefined) { sets.push('cwd = ?'); vals.push(data.cwd); }
  if (data.claudeSessionId !== undefined) { sets.push('claude_session_id = ?'); vals.push(data.claudeSessionId); }
  if (data.agentType !== undefined) { sets.push('agent_type = ?'); vals.push(data.agentType); }
  if (data.customCommand !== undefined) { sets.push('custom_command = ?'); vals.push(data.customCommand); }
  if (data.gridCol !== undefined) { sets.push('grid_col = ?'); vals.push(data.gridCol); }
  if (data.gridRow !== undefined) { sets.push('grid_row = ?'); vals.push(data.gridRow); }
  if (data.sortOrder !== undefined) { sets.push('sort_order = ?'); vals.push(data.sortOrder); }
  if (data.workspaceId !== undefined) { sets.push('workspace_id = ?'); vals.push(data.workspaceId); }
  if (data.isPopout !== undefined) { sets.push('is_popout = ?'); vals.push(data.isPopout ? 1 : 0); }
  if (data.winX !== undefined) { sets.push('win_x = ?'); vals.push(data.winX); }
  if (data.winY !== undefined) { sets.push('win_y = ?'); vals.push(data.winY); }
  if (data.winWidth !== undefined) { sets.push('win_width = ?'); vals.push(data.winWidth); }
  if (data.winHeight !== undefined) { sets.push('win_height = ?'); vals.push(data.winHeight); }
  if ((data as any).nodeId !== undefined) { sets.push('node_id = ?'); vals.push((data as any).nodeId); }

  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE panes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deletePane(id: string) {
  const db = getDb();
  db.prepare('DELETE FROM panes WHERE id = ?').run(id);
}

export function deletePanesByNodeId(nodeId: string) {
  const db = getDb();
  db.prepare('DELETE FROM panes WHERE node_id = ?').run(nodeId);
}

// ─── Workspace-as-Layout Operations ────────────────────────

export function getActiveWorkspace(): Workspace | null {
  const db = getDb();
  return db.prepare('SELECT id, name, description, color, created, is_active as isActive FROM workspaces WHERE is_active = 1').get() as Workspace | null;
}

export function switchWorkspace(workspaceId: number) {
  const db = getDb();
  db.prepare('UPDATE workspaces SET is_active = 0').run();
  db.prepare('UPDATE workspaces SET is_active = 1 WHERE id = ?').run(workspaceId);
}

export function duplicateWorkspace(sourceId: number, newName: string, newColor?: string): { workspace: Workspace; panes: PaneData[] } {
  const db = getDb();

  // Create the new workspace
  const src = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(sourceId) as any;
  const result = db.prepare(
    'INSERT INTO workspaces (name, description, color, is_active) VALUES (?, ?, ?, 0)'
  ).run(newName, src?.description || '', newColor || src?.color || '#6366f1');
  const newWsId = Number(result.lastInsertRowid);

  // Clone all panes from source workspace
  const srcPanes = db.prepare('SELECT * FROM panes WHERE workspace_id = ?').all(sourceId) as any[];
  const cloneStmt = db.prepare(`
    INSERT INTO panes (id, title, color, cwd, claude_session_id, agent_type, custom_command, grid_col, grid_row, sort_order, shell, workspace_id, is_popout, win_x, win_y, win_width, win_height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const cloneMany = db.transaction(() => {
    for (const p of srcPanes) {
      const newId = crypto.randomUUID();
      cloneStmt.run(
        newId, p.title, p.color, p.cwd, p.claude_session_id, p.agent_type || 'shell', p.custom_command || null,
        p.grid_col, p.grid_row, p.sort_order, p.shell,
        newWsId, 0, p.win_x, p.win_y, p.win_width, p.win_height
      );
    }
  });
  cloneMany();

  const ws: Workspace = { id: newWsId, name: newName, description: src?.description || '', color: newColor || src?.color || '#6366f1', created: new Date().toISOString() };
  const panes = getPanesByWorkspace(newWsId);
  return { workspace: ws, panes };
}

export function deleteWorkspaceFull(workspaceId: number) {
  const db = getDb();
  // Delete all panes belonging to this workspace
  db.prepare('DELETE FROM panes WHERE workspace_id = ?').run(workspaceId);
  db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);

  // If deleted the active workspace, activate another
  const anyActive = db.prepare('SELECT id FROM workspaces WHERE is_active = 1').get();
  if (!anyActive) {
    const first = db.prepare('SELECT id FROM workspaces ORDER BY id LIMIT 1').get() as { id: number } | undefined;
    if (first) {
      db.prepare('UPDATE workspaces SET is_active = 1 WHERE id = ?').run(first.id);
    }
  }
}

// ─── Analytics ──────────────────────────────────────────────

export function getAnalyticsOverview() {
  const db = getDb();
  const totals = db.prepare(`
    SELECT COUNT(*) as totalSessions, COALESCE(SUM(message_count), 0) as totalMessages
    FROM sessions
  `).get() as { totalSessions: number; totalMessages: number };

  const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };

  return {
    totalSessions: totals.totalSessions,
    totalMessages: totals.totalMessages,
    totalProjects: projectCount.count,
  };
}
