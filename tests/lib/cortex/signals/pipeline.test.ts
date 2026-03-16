import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignalPipeline } from '@/lib/cortex/signals/pipeline';
import type { SignalEnvelope } from '@/lib/cortex/signals/types';

const mockStore = {
  add: vi.fn().mockResolvedValue(undefined),
  search: vi.fn().mockResolvedValue([]),
};

const mockEmbedding = {
  embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  dimensions: 3,
  name: 'mock',
  init: vi.fn(),
};

const mockGraph = {
  createEdge: vi.fn(),
  incrementEdgeWeight: vi.fn(),
  getEntity: vi.fn().mockReturnValue(null),
};

const mockResolver = {
  extractEntities: vi.fn().mockReturnValue([]),
};

function makeEnvelope(overrides: Partial<SignalEnvelope> = {}): SignalEnvelope {
  return {
    text: 'Fix auth timeout by increasing pool size',
    origin: { source_type: 'git_commit', source_ref: 'abc123', creator_entity_id: 'person-alice' },
    entities: [],
    suggested_type: 'error_fix',
    suggested_sensitivity: 'internal',
    raw_metadata: {},
    ...overrides,
  };
}

describe('SignalPipeline', () => {
  let pipeline: SignalPipeline;

  beforeEach(() => {
    vi.clearAllMocks();
    pipeline = new SignalPipeline({
      store: mockStore as any,
      embedding: mockEmbedding as any,
      graph: mockGraph as any,
      resolver: mockResolver as any,
    });
  });

  it('ingests a signal envelope and stores it', async () => {
    const result = await pipeline.ingest(makeEnvelope());
    expect(result.accepted).toBe(1);
    expect(mockEmbedding.embed).toHaveBeenCalledWith(['Fix auth timeout by increasing pool size']);
    expect(mockStore.add).toHaveBeenCalledTimes(1);
  });

  it('uses suggested_type from envelope', async () => {
    await pipeline.ingest(makeEnvelope({ suggested_type: 'decision' }));
    const addCall = mockStore.add.mock.calls[0];
    expect(addCall[1].type).toBe('decision');
  });

  it('auto-classifies sensitivity (most restrictive wins)', async () => {
    // Text contains API key → confidential, overrides suggested 'internal'
    await pipeline.ingest(makeEnvelope({
      text: 'Set API_KEY=sk-ant-abc123 in production',
      suggested_sensitivity: 'internal',
    }));
    const addCall = mockStore.add.mock.calls[0];
    expect(addCall[1].sensitivity).toBe('confidential');
  });

  it('keeps suggested_sensitivity when more restrictive than auto-classification', async () => {
    await pipeline.ingest(makeEnvelope({
      text: 'General technical note',  // auto-classifies as internal or public
      suggested_sensitivity: 'restricted',  // more restrictive
    }));
    const addCall = mockStore.add.mock.calls[0];
    expect(addCall[1].sensitivity).toBe('restricted');
  });

  it('processes edge updates from raw_metadata', async () => {
    await pipeline.ingest(makeEnvelope({
      raw_metadata: {
        edge_updates: [
          { source_id: 'person-alice', target_id: 'topic-auth', relation: 'expert_in', weight_delta: 0.05 },
        ],
      },
    }));
    expect(mockGraph.incrementEdgeWeight).toHaveBeenCalledWith(
      'person-alice', 'topic-auth', 'expert_in', 0.05
    );
  });

  it('deduplicates by text hash', async () => {
    const envelope = makeEnvelope();
    await pipeline.ingest(envelope);
    const result = await pipeline.ingest(envelope);  // same text
    expect(result.skipped).toBe(1);
    expect(result.accepted).toBe(0);
    expect(mockStore.add).toHaveBeenCalledTimes(1);  // only first call
  });

  it('ingests batch of envelopes', async () => {
    const envelopes = [
      makeEnvelope({ text: 'First signal' }),
      makeEnvelope({ text: 'Second signal' }),
      makeEnvelope({ text: 'Third signal' }),
    ];
    const result = await pipeline.ingestBatch(envelopes);
    expect(result.accepted).toBe(3);
    expect(mockStore.add).toHaveBeenCalledTimes(3);
  });

  it('handles embedding failures gracefully', async () => {
    mockEmbedding.embed.mockRejectedValueOnce(new Error('embed failed'));
    const result = await pipeline.ingest(makeEnvelope());
    expect(result.errors).toHaveLength(1);
    expect(result.accepted).toBe(0);
  });
});
