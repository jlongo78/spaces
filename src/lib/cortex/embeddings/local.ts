import type { EmbeddingProvider } from './index';
import { cortexDebug } from '../debug';

export class LocalEmbeddingProvider implements EmbeddingProvider {
  name = 'local' as const;
  dimensions = 384;
  private pipeline: any = null;

  async init(): Promise<void> {
    if (this.pipeline) return;
    const { pipeline } = await import('@huggingface/transformers');
    this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      device: 'cpu',
      dtype: 'fp32',  // explicit — model is small (22MB), fp32 is fine for MiniLM
    });
  }

  private embedCount = 0;

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.pipeline) await this.init();
    const before = process.memoryUsage();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
      results.push(Array.from(output.data as Float32Array));
      // Dispose ONNX tensor to prevent memory leak
      if (typeof output.dispose === 'function') output.dispose();
    }
    this.embedCount += texts.length;
    const after = process.memoryUsage();
    const deltaHeap = Math.round((after.heapUsed - before.heapUsed) / 1048576);
    const deltaExt = Math.round(((after.external || 0) - (before.external || 0)) / 1048576);
    const deltaAB = Math.round(((after.arrayBuffers || 0) - (before.arrayBuffers || 0)) / 1048576);
    if (deltaHeap > 5 || deltaExt > 5 || deltaAB > 5 || this.embedCount % 50 === 0) {
      cortexDebug(`[Embed] ${texts.length} texts (total=${this.embedCount}): heap=${deltaHeap > 0 ? '+' : ''}${deltaHeap}MB ext=${deltaExt > 0 ? '+' : ''}${deltaExt}MB ab=${deltaAB > 0 ? '+' : ''}${deltaAB}MB`);
    }
    return results;
  }
}
