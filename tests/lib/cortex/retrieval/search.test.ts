import { describe, it, expect, vi } from 'vitest';
import { CortexSearch, type SearchOptions } from '@/lib/cortex/retrieval/search';

describe('CortexSearch', () => {
  it('searches multiple layers and merges results by score', async () => {
    const mockStore = {
      search: vi.fn()
        .mockResolvedValueOnce([ // personal results
          { id: 'p1', text: 'personal pref', type: 'preference', confidence: 0.9,
            stale_score: 0, created: new Date().toISOString(), layer: 'personal',
            workspace_id: null, session_id: null, agent_type: 'claude',
            project_path: null, file_refs: [], access_count: 0,
            last_accessed: null, metadata: {}, source_timestamp: new Date().toISOString(),
            vector: [], _distance: 0.1 },
        ])
        .mockResolvedValueOnce([ // workspace results
          { id: 'w1', text: 'workspace pattern', type: 'pattern', confidence: 0.8,
            stale_score: 0, created: new Date().toISOString(), layer: 'workspace',
            workspace_id: 1, session_id: null, agent_type: 'claude',
            project_path: null, file_refs: [], access_count: 0,
            last_accessed: null, metadata: {}, source_timestamp: new Date().toISOString(),
            vector: [], _distance: 0.2 },
        ]),
    } as any;

    const search = new CortexSearch(mockStore);
    const results = await search.search(
      [0.1, 0.2, 0.3],
      { workspaceId: 1, limit: 5 },
    );

    expect(results.length).toBe(2);
    expect(results[0].id).toBe('p1');
  });
});
