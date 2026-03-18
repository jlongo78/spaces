import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getCortex, isCortexAvailable } from '@/lib/cortex';
import { getDb } from '@/lib/db/schema';
import { entityId, slugify } from '@/lib/cortex/graph/types';
import type { EdgeRelation, EntityType } from '@/lib/cortex/graph/types';

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }
    const cortex = await getCortex();
    if (!cortex?.graph) {
      return NextResponse.json({ error: 'Cortex disabled' }, { status: 503 });
    }

    const graph = cortex.graph;
    const db = getDb();
    let created = 0;
    let edges = 0;

    const ensure = (id: string, type: EntityType, name: string, metadata?: Record<string, unknown>) => {
      if (!graph.getEntity(id)) {
        graph.createEntity({ id, type, name, metadata });
        created++;
      }
    };

    const link = (source: string, target: string, relation: EdgeRelation, weight?: number) => {
      try {
        graph.createEdge({ source_id: source, target_id: target, relation, weight });
        edges++;
      } catch { /* dupe */ }
    };

    // ── 1. Current user ──────────────────────────────────────
    const personId = entityId('person', slugify(user));
    ensure(personId, 'person', user);

    // ── 2. Workspaces ────────────────────────────────────────
    const workspaces = db.prepare('SELECT id, name, color FROM workspaces').all() as { id: number; name: string; color: string }[];
    const wsIdMap = new Map<number, string>();
    for (const ws of workspaces) {
      const id = entityId('project', slugify(ws.name));
      ensure(id, 'project', ws.name, { workspaceId: ws.id, color: ws.color });
      link(personId, id, 'owns');
      wsIdMap.set(ws.id, id);
    }

    // ── 3. Dev projects (from session project_path) ──────────
    const projects = db.prepare(`
      SELECT p.id, p.name, p.path, p.agent_type as agentType,
             COUNT(s.id) as sessionCount
      FROM projects p
      LEFT JOIN sessions s ON s.project_id = p.id
      GROUP BY p.id
    `).all() as { id: string; name: string; path: string; agentType: string; sessionCount: number }[];

    const projIdMap = new Map<string, string>();
    for (const p of projects) {
      const id = entityId('system', slugify(p.name));
      ensure(id, 'system', p.name, { path: p.path, agentType: p.agentType, sessions: p.sessionCount });
      link(personId, id, 'works_on');
      projIdMap.set(p.id, id);
    }

    // ── 4. Git branches as modules ──────────────────────────
    const branches = db.prepare(`
      SELECT DISTINCT git_branch, project_path
      FROM sessions
      WHERE git_branch IS NOT NULL AND git_branch != '' AND git_branch != 'main' AND git_branch != 'master'
    `).all() as { git_branch: string; project_path: string }[];

    for (const b of branches) {
      const id = entityId('module', slugify(b.git_branch));
      ensure(id, 'module', b.git_branch, { branch: true });

      // Link branch to its project
      if (b.project_path) {
        const projName = b.project_path.split(/[/\\]/).pop() || b.project_path;
        const projGraphId = entityId('system', slugify(projName));
        link(id, projGraphId, 'part_of');
      }
    }

    // ── 5. Topics from knowledge tags & session activity ─────
    // Extract topics from session summaries (common patterns)
    const summaries = db.prepare(`
      SELECT COALESCE(custom_name, summary, first_prompt) as text, project_path, agent_type as agentType
      FROM sessions
      WHERE (summary IS NOT NULL AND summary != '') OR (first_prompt IS NOT NULL AND first_prompt != '')
      ORDER BY modified DESC
      LIMIT 200
    `).all() as { text: string; project_path: string; agentType: string }[];

    // Extract topic keywords from summaries
    const topicCounts = new Map<string, { count: number; projects: Set<string> }>();
    const topicPatterns = /\b(auth|api|database|testing|deploy|ci[/-]cd|refactor|bug\s*fix|migration|security|performance|frontend|backend|ui|ux|docker|kubernetes|graphql|rest|websocket|cache|queue|search|analytics|monitor|log|config|setup|infra)\b/gi;

    for (const s of summaries) {
      if (!s.text) continue;
      const matches = s.text.match(topicPatterns);
      if (!matches) continue;
      const seen = new Set<string>();
      for (const m of matches) {
        const topic = m.toLowerCase().replace(/\s+/g, '-');
        if (seen.has(topic)) continue;
        seen.add(topic);
        if (!topicCounts.has(topic)) topicCounts.set(topic, { count: 0, projects: new Set() });
        const tc = topicCounts.get(topic)!;
        tc.count++;
        if (s.project_path) {
          const projName = s.project_path.split(/[/\\]/).pop() || s.project_path;
          tc.projects.add(projName);
        }
      }
    }

    // Only create topics that appear 2+ times
    for (const [topic, data] of topicCounts) {
      if (data.count < 2) continue;
      const id = entityId('topic', topic);
      ensure(id, 'topic', topic, { mentions: data.count });

      // Link topics to projects
      for (const projName of data.projects) {
        const projGraphId = entityId('system', slugify(projName));
        if (graph.getEntity(projGraphId)) {
          link(projGraphId, id, 'relates_to');
        }
      }

      // Link user to frequently-used topics
      if (data.count >= 3) {
        link(personId, id, 'expert_in', data.count);
      }
    }

    // ── 6. Agent types as tools ──────────────────────────────
    const agentTypes = db.prepare(`
      SELECT agent_type, COUNT(*) as cnt
      FROM sessions
      WHERE agent_type IS NOT NULL AND agent_type != ''
      GROUP BY agent_type
      HAVING cnt >= 2
    `).all() as { agent_type: string; cnt: number }[];

    for (const at of agentTypes) {
      const id = entityId('topic', slugify(`${at.agent_type}-agent`));
      ensure(id, 'topic', `${at.agent_type} agent`, { agentType: at.agent_type, sessions: at.cnt });
      link(personId, id, 'works_on', at.cnt);
    }

    // ── 7. Cross-link projects to workspaces via sessions ────
    const wsProjectLinks = db.prepare(`
      SELECT DISTINCT pa.workspace_id, s.project_id
      FROM sessions s
      JOIN panes pa ON pa.id = s.pane_id
      WHERE pa.workspace_id IS NOT NULL AND s.project_id IS NOT NULL
    `).all() as { workspace_id: number; project_id: string }[];

    for (const wpl of wsProjectLinks) {
      const wsGraphId = wsIdMap.get(wpl.workspace_id);
      const projGraphId = projIdMap.get(wpl.project_id);
      if (wsGraphId && projGraphId) {
        link(wsGraphId, projGraphId, 'contains');
      }
    }

    // ── 8. Cross-link projects that share branches ───────────
    const sharedBranches = db.prepare(`
      SELECT git_branch, GROUP_CONCAT(DISTINCT project_path) as paths
      FROM sessions
      WHERE git_branch IS NOT NULL AND git_branch != '' AND project_path IS NOT NULL
      GROUP BY git_branch
      HAVING COUNT(DISTINCT project_path) > 1
    `).all() as { git_branch: string; paths: string }[];

    for (const sb of sharedBranches) {
      const projectPaths = sb.paths.split(',');
      for (let i = 0; i < projectPaths.length; i++) {
        for (let j = i + 1; j < projectPaths.length; j++) {
          const nameA = projectPaths[i].split(/[/\\]/).pop() || projectPaths[i];
          const nameB = projectPaths[j].split(/[/\\]/).pop() || projectPaths[j];
          const idA = entityId('system', slugify(nameA));
          const idB = entityId('system', slugify(nameB));
          if (graph.getEntity(idA) && graph.getEntity(idB)) {
            link(idA, idB, 'depends_on');
          }
        }
      }
    }

    return NextResponse.json({
      created,
      edges,
      total: graph.listEntities({}).length,
    });
  });
}
