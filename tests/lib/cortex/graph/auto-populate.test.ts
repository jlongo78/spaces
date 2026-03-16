import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EntityGraph } from '@/lib/cortex/graph/entity-graph';
import { autoPopulate } from '@/lib/cortex/graph/auto-populate';

vi.mock('@/lib/auth', () => ({
  getCurrentUser: () => 'test-user',
  getAuthUser: () => 'test-user',
  withUser: (_user: string, fn: () => any) => fn(),
}));

describe('autoPopulate', () => {
  let tmpDir: string;
  let graph: EntityGraph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-autopopulate-'));
    graph = new EntityGraph(path.join(tmpDir, 'graph.db'));
  });

  afterEach(() => {
    graph.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates default organization entity', () => {
    autoPopulate(graph, { orgName: 'Acme Corp' });

    const org = graph.getEntity('organization-acme-corp');
    expect(org).not.toBeNull();
    expect(org!.name).toBe('Acme Corp');
    expect(org!.type).toBe('organization');
  });

  it('creates person entities from user list', () => {
    autoPopulate(graph, {
      orgName: 'Acme Corp',
      users: [
        { name: 'Alice Smith', email: 'alice@acme.com', role: 'engineer' },
        { name: 'Bob Jones', email: 'bob@acme.com' },
      ],
    });

    const alice = graph.getEntity('person-alice-smith');
    expect(alice).not.toBeNull();
    expect(alice!.name).toBe('Alice Smith');
    expect(alice!.metadata['email']).toBe('alice@acme.com');
    expect(alice!.metadata['role']).toBe('engineer');

    const bob = graph.getEntity('person-bob-jones');
    expect(bob).not.toBeNull();
    expect(bob!.name).toBe('Bob Jones');
    expect(bob!.metadata['email']).toBe('bob@acme.com');
  });

  it('creates team entities and membership edges', () => {
    autoPopulate(graph, {
      orgName: 'Acme Corp',
      users: [
        { name: 'Alice Smith' },
      ],
      teams: [
        { name: 'Platform', department: 'Engineering', members: ['Alice Smith'] },
      ],
    });

    const team = graph.getEntity('team-platform');
    expect(team).not.toBeNull();
    expect(team!.type).toBe('team');

    const dept = graph.getEntity('department-engineering');
    expect(dept).not.toBeNull();
    expect(dept!.type).toBe('department');

    // person → team (member_of)
    const memberEdges = graph.getEdgesFrom('person-alice-smith', 'member_of');
    expect(memberEdges.some(e => e.target_id === 'team-platform')).toBe(true);

    // team → dept (part_of)
    const teamPartOf = graph.getEdgesFrom('team-platform', 'part_of');
    expect(teamPartOf.some(e => e.target_id === 'department-engineering')).toBe(true);

    // dept → org (part_of)
    const deptPartOf = graph.getEdgesFrom('department-engineering', 'part_of');
    expect(deptPartOf.some(e => e.target_id === 'organization-acme-corp')).toBe(true);
  });

  it('is idempotent — running twice creates no duplicates', () => {
    const config = {
      orgName: 'Acme Corp',
      users: [{ name: 'Alice Smith' }],
    };

    autoPopulate(graph, config);
    autoPopulate(graph, config);

    const people = graph.listEntities({ type: 'person' });
    const alice = people.filter(p => p.id === 'person-alice-smith');
    expect(alice).toHaveLength(1);
  });

  it('creates project entities from workspace data', () => {
    autoPopulate(graph, {
      orgName: 'Acme Corp',
      teams: [
        { name: 'Platform' },
      ],
      projects: [
        { name: 'Spaces', team: 'Platform', repoUrl: 'https://github.com/acme/spaces' },
      ],
    });

    const project = graph.getEntity('project-spaces');
    expect(project).not.toBeNull();
    expect(project!.name).toBe('Spaces');
    expect(project!.metadata['repoUrl']).toBe('https://github.com/acme/spaces');

    // team → project (owns)
    const ownsEdges = graph.getEdgesFrom('team-platform', 'owns');
    expect(ownsEdges.some(e => e.target_id === 'project-spaces')).toBe(true);
  });
});
