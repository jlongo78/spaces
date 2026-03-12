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
});
