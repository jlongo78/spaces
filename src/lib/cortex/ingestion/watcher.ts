import fs from 'fs';
import path from 'path';

export interface SyncState {
  filePath: string;
  mtime: number;
  byteOffset: number;
}

export class IngestionWatcher {
  private statePath: string;
  private state: Map<string, SyncState> = new Map();

  constructor(cortexDir: string) {
    this.statePath = path.join(cortexDir, 'ingest-state.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.statePath)) {
        const raw = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
        for (const entry of raw) {
          this.state.set(entry.filePath, entry);
        }
      }
    } catch { /* start fresh */ }
  }

  save(): void {
    fs.writeFileSync(this.statePath, JSON.stringify(Array.from(this.state.values()), null, 2));
  }

  needsSync(filePath: string): boolean {
    const stat = fs.statSync(filePath);
    const existing = this.state.get(filePath);
    if (!existing) return true;
    return stat.mtimeMs > existing.mtime || stat.size > existing.byteOffset;
  }

  markSynced(filePath: string, byteOffset: number): void {
    const stat = fs.statSync(filePath);
    this.state.set(filePath, {
      filePath,
      mtime: stat.mtimeMs,
      byteOffset,
    });
  }

  getOffset(filePath: string): number {
    return this.state.get(filePath)?.byteOffset ?? 0;
  }
}
