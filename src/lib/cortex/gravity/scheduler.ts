export const GRAVITY_INTERVAL_MS = 6 * 60 * 60 * 1000;  // 6 hours

export interface GravitySchedulerConfig {
  intervalMs?: number;
  runCycle: () => Promise<void>;
}

export class GravityScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private cycling = false;
  private config: Required<GravitySchedulerConfig>;

  constructor(config: GravitySchedulerConfig) {
    this.config = {
      intervalMs: config.intervalMs ?? GRAVITY_INTERVAL_MS,
      runCycle: config.runCycle,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.executeCycle();  // run first cycle immediately
    this.timer = setInterval(() => this.executeCycle(), this.config.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  isRunning(): boolean { return this.running; }

  private async executeCycle(): Promise<void> {
    if (this.cycling) return;  // prevent concurrent
    this.cycling = true;
    try { await this.config.runCycle(); }
    catch { /* survive errors */ }
    finally { this.cycling = false; }
  }
}
