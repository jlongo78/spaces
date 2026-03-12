import type { CortexStore } from '../store';
import type { EmbeddingProvider } from '../embeddings';
import { federationSearch } from './federation';

export interface SyncOptions {
  intervalMs: number;
  connectedNodes: Array<{ id: string; url: string }>;
  timeoutMs: number;
}

export class FederationSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private store: CortexStore,
    private embedding: EmbeddingProvider,
    private options: SyncOptions,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sync(), this.options.intervalMs);
    this.sync();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sync(): Promise<void> {
    if (this.running || this.options.connectedNodes.length === 0) return;
    this.running = true;

    try {
      const results = await federationSearch({
        query: '*',
        queryVector: new Array(this.embedding.dimensions).fill(0),
        connectedNodes: this.options.connectedNodes,
        timeoutMs: this.options.timeoutMs,
        limit: 50,
      });

      for (const unit of results) {
        try {
          if (!unit.vector) {
            const [vec] = await this.embedding.embed([unit.text]);
            unit.vector = vec;
          }
          unit.layer = 'team';
          await this.store.add('team', unit);
        } catch { /* skip individual failures */ }
      }
    } catch (err) {
      console.error('[Cortex] Background sync error:', err);
    } finally {
      this.running = false;
    }
  }
}
