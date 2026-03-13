import fs from 'fs';
import path from 'path';

const QUEUE_FILE = 'distill-queue.json';

export interface QueueEntry {
  text: string;
  layerKey: string;
  workspaceId: number | null;
  agentType: string;
}

/** Simple file-backed queue mapping chunk IDs to their text + context. */
export class DistillationQueue {
  private data: Record<string, QueueEntry> = {};
  private filePath: string;

  constructor(cortexDir: string) {
    this.filePath = path.join(cortexDir, QUEUE_FILE);
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch { this.data = {}; }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data));
  }

  enqueue(id: string, entry: QueueEntry): void {
    this.data[id] = entry;
    this.save();
  }

  getEntries(ids: string[]): QueueEntry[] {
    return ids.map(id => this.data[id]).filter((e): e is QueueEntry => e !== undefined);
  }

  getTexts(ids: string[]): string[] {
    return this.getEntries(ids).map(e => e.text);
  }

  remove(ids: string[]): void {
    for (const id of ids) delete this.data[id];
    this.save();
  }

  pendingIds(): string[] {
    return Object.keys(this.data);
  }
}
