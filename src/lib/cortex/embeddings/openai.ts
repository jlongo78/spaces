import type { EmbeddingProvider } from './index';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = 'openai' as const;
  dimensions = 1536;
  private apiKey: string = '';

  async init(): Promise<void> {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: 'text-embedding-3-small' }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.data
      .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
      .map((item: { embedding: number[] }) => item.embedding);
  }
}
