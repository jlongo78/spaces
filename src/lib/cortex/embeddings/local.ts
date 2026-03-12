import type { EmbeddingProvider } from './index';

export class LocalEmbeddingProvider implements EmbeddingProvider {
  name = 'local' as const;
  dimensions = 384;
  private pipeline: any = null;

  async init(): Promise<void> {
    if (this.pipeline) return;
    const { pipeline } = await import('@huggingface/transformers');
    this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      device: 'cpu',
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.pipeline) await this.init();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }
}
