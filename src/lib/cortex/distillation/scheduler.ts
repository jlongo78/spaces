export class DistillationScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingChunkIds: string[] = [];
  private running = false;
  private idleDelayMs: number;

  constructor(
    private onDistill: (chunkIds: string[]) => Promise<void>,
    idleDelayMs = 30_000,
  ) {
    this.idleDelayMs = idleDelayMs;
  }

  enqueue(chunkIds: string[]): void {
    this.pendingChunkIds.push(...chunkIds);
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.idleDelayMs);
  }

  private async flush(): Promise<void> {
    if (this.running || this.pendingChunkIds.length === 0) return;
    this.running = true;

    const batch = this.pendingChunkIds.splice(0, 50);
    try {
      await this.onDistill(batch);
    } catch (err) {
      console.error('[Cortex] Distillation error:', err);
      this.pendingChunkIds.unshift(...batch);
    } finally {
      this.running = false;
      if (this.pendingChunkIds.length > 0) {
        this.resetTimer();
      }
    }
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get pendingCount(): number {
    return this.pendingChunkIds.length;
  }
}
