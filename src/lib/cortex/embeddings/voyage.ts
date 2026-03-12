import type { EmbeddingProvider } from './index';

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  name = 'voyage' as const;
  dimensions = 1024;
  private apiKey: string = '';

  async init(): Promise<void> {
    this.apiKey = process.env.VOYAGE_API_KEY || '';
    if (!this.apiKey) throw new Error('VOYAGE_API_KEY not set');
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: 'voyage-3' }),
    });
    if (!response.ok) {
      throw new Error(`Voyage API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.data.map((item: { embedding: number[] }) => item.embedding);
  }
}
