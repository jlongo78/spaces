import type { EntityGraph } from './entity-graph';
import { slugify, entityId } from './types';

interface UserInput {
  name: string;
  email?: string;
  role?: string;
}

interface TeamInput {
  name: string;
  department?: string;
  members?: string[];
}

interface ProjectInput {
  name: string;
  team?: string;
  repoUrl?: string;
}

export interface AutoPopulateConfig {
  orgName: string;
  users?: UserInput[];
  teams?: TeamInput[];
  projects?: ProjectInput[];
}

function ensureEntity(
  graph: EntityGraph,
  id: string,
  type: Parameters<EntityGraph['createEntity']>[0]['type'],
  name: string,
  metadata?: Record<string, unknown>,
): void {
  if (!graph.getEntity(id)) {
    graph.createEntity({ id, type, name, metadata });
  }
}

export function autoPopulate(graph: EntityGraph, config: AutoPopulateConfig): void {
  // 1. Create organization (idempotent)
  const orgId = entityId('organization', slugify(config.orgName));
  ensureEntity(graph, orgId, 'organization', config.orgName);

  // 2. Create teams + departments
  for (const team of config.teams ?? []) {
    const teamId = entityId('team', slugify(team.name));
    ensureEntity(graph, teamId, 'team', team.name);

    if (team.department) {
      const deptId = entityId('department', slugify(team.department));
      ensureEntity(graph, deptId, 'department', team.department);

      // team → dept (part_of)
      graph.createEdge({ source_id: teamId, target_id: deptId, relation: 'part_of' });
      // dept → org (part_of)
      graph.createEdge({ source_id: deptId, target_id: orgId, relation: 'part_of' });
    }
  }

  // 3. Create users and resolve team memberships
  for (const user of config.users ?? []) {
    const personId = entityId('person', slugify(user.name));
    const metadata: Record<string, unknown> = {};
    if (user.email) metadata['email'] = user.email;
    if (user.role) metadata['role'] = user.role;

    ensureEntity(graph, personId, 'person', user.name, metadata);

    // Link to teams that list this user as a member
    for (const team of config.teams ?? []) {
      if (team.members && team.members.includes(user.name)) {
        const teamId = entityId('team', slugify(team.name));
        graph.createEdge({ source_id: personId, target_id: teamId, relation: 'member_of' });
      }
    }
  }

  // 4. Create projects and link to teams
  for (const project of config.projects ?? []) {
    const projectId = entityId('project', slugify(project.name));
    const metadata: Record<string, unknown> = {};
    if (project.repoUrl) metadata['repoUrl'] = project.repoUrl;

    ensureEntity(graph, projectId, 'project', project.name, metadata);

    if (project.team) {
      const teamId = entityId('team', slugify(project.team));
      // team → project (owns)
      graph.createEdge({ source_id: teamId, target_id: projectId, relation: 'owns' });
    }
  }
}
