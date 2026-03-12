export interface EmbeddingProvider {
  name: string;
  dimensions: number;
  init(): Promise<void>;
  embed(texts: string[]): Promise<number[][]>;
}

export async function detectProvider(
  preference: 'auto' | 'voyage' | 'openai' | 'local',
): Promise<EmbeddingProvider> {
  if (preference !== 'auto') {
    return createProvider(preference);
  }
  if (process.env.VOYAGE_API_KEY) {
    return createProvider('voyage');
  }
  if (process.env.OPENAI_API_KEY) {
    return createProvider('openai');
  }
  return createProvider('local');
}

async function createProvider(name: string): Promise<EmbeddingProvider> {
  switch (name) {
    case 'voyage': {
      const { VoyageEmbeddingProvider } = await import('./voyage');
      const p = new VoyageEmbeddingProvider();
      await p.init();
      return p;
    }
    case 'openai': {
      const { OpenAIEmbeddingProvider } = await import('./openai');
      const p = new OpenAIEmbeddingProvider();
      await p.init();
      return p;
    }
    default: {
      const { LocalEmbeddingProvider } = await import('./local');
      const p = new LocalEmbeddingProvider();
      await p.init();
      return p;
    }
  }
}
