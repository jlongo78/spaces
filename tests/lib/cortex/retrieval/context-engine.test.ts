import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContextEngine } from '@/lib/cortex/retrieval/context-engine';

const mockStore = {
  search: vi.fn().mockResolvedValue([]),
};
const mockGraph = {
  proximity: vi.fn().mockReturnValue(0.5),
  neighborhood: vi.fn().mockReturnValue([]),
  getEntity: vi.fn().mockReturnValue(null),
};
const mockResolver = {
  extractEntities: vi.fn().mockReturnValue([]),
};
const mockEmbedding = {
  embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  dimensions: 3,
  name: 'mock',
  init: vi.fn(),
};

describe('ContextEngine', () => {
  let engine: ContextEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new ContextEngine({
      store: mockStore as any,
      graph: mockGraph as any,
      resolver: mockResolver as any,
      embedding: mockEmbedding as any,
      requesterId: 'person-alice',
    });
  });

  it('returns empty context for empty results', async () => {
    const result = await engine.assemble('some query');
    expect(result.results).toHaveLength(0);
    expect(result.context).toBe('');
  });

  it('calls embedding.embed with the query', async () => {
    await engine.assemble('test query');
    expect(mockEmbedding.embed).toHaveBeenCalledWith(['test query']);
  });

  it('detects intent from the query', async () => {
    const result = await engine.assemble('why does auth throw an error?');
    expect(result.intent.intent).toBe('debugging');
  });

  it('extracts entities from the query', async () => {
    mockResolver.extractEntities.mockReturnValue([
      { entity: { id: 'system-auth', type: 'system', name: 'Auth' }, confidence: 0.9, method: 'alias' },
    ]);
    const result = await engine.assemble('fix the auth service');
    expect(result.entities).toHaveLength(1);
  });

  it('searches store and returns formatted context', async () => {
    mockStore.search.mockResolvedValue([{
      id: 'k1', text: 'test knowledge', type: 'decision', layer: 'personal',
      confidence: 0.8, stale_score: 0, created: new Date().toISOString(),
      source_timestamp: new Date().toISOString(), evidence_score: 0.7,
      contradiction_refs: [], _distance: 0.2,
      workspace_id: null, session_id: null, agent_type: 'claude',
      project_path: null, file_refs: [], access_count: 0, last_accessed: null, metadata: {},
    }]);
    const result = await engine.assemble('test query');
    expect(result.results.length).toBeGreaterThanOrEqual(1);
    expect(result.context).toContain('<cortex-context>');
  });

  it('records timing information', async () => {
    const result = await engine.assemble('test query');
    expect(result.timing.totalMs).toBeDefined();
    expect(result.timing.intentMs).toBeDefined();
    expect(result.timing.searchMs).toBeDefined();
  });
});
