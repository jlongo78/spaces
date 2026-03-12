import { describe, it, expect, vi } from 'vitest';
import { type EmbeddingProvider, detectProvider } from '@/lib/cortex/embeddings';

describe('embedding provider detection', () => {
  it('falls back to local when no API keys', async () => {
    const provider = await detectProvider('auto');
    expect(provider.name).toBe('local');
    expect(provider.dimensions).toBe(384);
  });

  it('respects explicit provider choice', async () => {
    const provider = await detectProvider('local');
    expect(provider.name).toBe('local');
  });
});
