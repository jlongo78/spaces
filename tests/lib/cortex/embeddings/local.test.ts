import { describe, it, expect } from 'vitest';
import { LocalEmbeddingProvider } from '@/lib/cortex/embeddings/local';

describe('LocalEmbeddingProvider', () => {
  it('produces 384-dimension vectors', async () => {
    const provider = new LocalEmbeddingProvider();
    await provider.init();
    const vectors = await provider.embed(['hello world']);
    expect(vectors).toHaveLength(1);
    expect(vectors[0]).toHaveLength(384);
    const magnitude = Math.sqrt(vectors[0].reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 1);
  }, 60000);

  it('embeds multiple texts in batch', async () => {
    const provider = new LocalEmbeddingProvider();
    await provider.init();
    const vectors = await provider.embed(['first text', 'second text', 'third text']);
    expect(vectors).toHaveLength(3);
    vectors.forEach(v => expect(v).toHaveLength(384));
  }, 60000);
});
