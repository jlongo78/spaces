import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionPipeline } from '@/lib/cortex/ingestion/pipeline';
import type { EmbeddingProvider } from '@/lib/cortex/embeddings';
import type { CortexStore } from '@/lib/cortex/store';

describe('IngestionPipeline', () => {
  let mockProvider: EmbeddingProvider;
  let mockStore: any;
  let pipeline: IngestionPipeline;

  beforeEach(() => {
    mockProvider = {
      name: 'test',
      dimensions: 3,
      init: vi.fn(),
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };
    mockStore = {
      add: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      updateAccessCount: vi.fn().mockResolvedValue(undefined),
    };
    pipeline = new IngestionPipeline(mockProvider, mockStore);
  });

  it('processes messages through Tier 1 and Tier 2', async () => {
    const messages = [
      { role: 'human', content: 'Add auth', timestamp: new Date().toISOString() },
      { role: 'assistant', content: 'Adding JWT auth now.', timestamp: new Date().toISOString() },
    ];

    const result = await pipeline.ingest(messages, {
      sessionId: 's1',
      workspaceId: 1,
      agentType: 'claude',
      projectPath: '/p',
    });

    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.chunksEmbedded).toBeGreaterThan(0);
    expect(mockProvider.embed).toHaveBeenCalled();
    expect(mockStore.add).toHaveBeenCalled();
  });

  it('skips duplicate chunks (hash match)', async () => {
    const msg = { role: 'human', content: 'Add auth', timestamp: new Date().toISOString() };
    const msgs = [msg, { role: 'assistant', content: 'Done.', timestamp: new Date().toISOString() }];
    const ctx = { sessionId: 's1', workspaceId: 1, agentType: 'claude' as const, projectPath: '/p' };

    // Ingest twice with identical content
    await pipeline.ingest(msgs, ctx);
    await pipeline.ingest(msgs, ctx);

    // store.add should only be called once (second ingest is hash-deduped)
    expect(mockStore.add).toHaveBeenCalledTimes(1);
  });

  it('skips cosine-similar chunks and bumps access count', async () => {
    // store.search returns a near-match with L2 distance below threshold
    mockStore.search.mockResolvedValueOnce([{
      id: 'existing-1', text: 'similar text', _distance: 0.01,
      access_count: 0, confidence: 0.8,
    }]);

    const msgs = [
      { role: 'human', content: 'Slightly different auth', timestamp: new Date().toISOString() },
      { role: 'assistant', content: 'Done.', timestamp: new Date().toISOString() },
    ];
    const ctx = { sessionId: 's2', workspaceId: 1, agentType: 'claude' as const, projectPath: '/p' };

    await pipeline.ingest(msgs, ctx);

    expect(mockStore.updateAccessCount).toHaveBeenCalledWith(expect.any(String), 'existing-1');
    expect(mockStore.add).not.toHaveBeenCalled();
  });
});
