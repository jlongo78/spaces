import fs from 'fs';
import path from 'path';
import tar from 'tar';
import type { CortexStore } from '../store';
import type { EmbeddingProvider } from '../embeddings';
import type { KnowledgeUnit } from '../knowledge/types';

export type MergeStrategy = 'append' | 'merge' | 'replace';

export function parseKnowledgeJSONL(jsonl: string): any[] {
  const units: any[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      units.push(JSON.parse(line));
    } catch { /* skip malformed */ }
  }
  return units;
}

export function applyMergeStrategy(
  strategy: MergeStrategy,
  incoming: any[],
  existing: any[],
): any[] {
  if (strategy === 'append' || strategy === 'replace') {
    return incoming;
  }

  const existingTexts = new Set(existing.map(u => u.text));
  return incoming.filter(u => !existingTexts.has(u.text));
}

export interface ImportProgress {
  status: 'idle' | 'running' | 'complete' | 'error';
  totalUnits: number;
  importedUnits: number;
  errors: string[];
}

let _importProgress: ImportProgress = {
  status: 'idle', totalUnits: 0, importedUnits: 0, errors: [],
};

export function getImportProgress(): ImportProgress {
  return { ..._importProgress };
}

export async function importCortexpack(
  archivePath: string,
  store: CortexStore,
  embedding: EmbeddingProvider,
  opts: {
    targetLayer: string;
    mergeStrategy: MergeStrategy;
    reEmbed?: boolean;
  },
): Promise<ImportProgress> {
  _importProgress = { status: 'running', totalUnits: 0, importedUnits: 0, errors: [] };

  const tmpDir = `${archivePath}.extract`;
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    await tar.extract({ file: archivePath, cwd: tmpDir });

    const jsonlPath = path.join(tmpDir, 'knowledge.jsonl');
    if (!fs.existsSync(jsonlPath)) {
      throw new Error('knowledge.jsonl not found in archive');
    }

    const incoming = parseKnowledgeJSONL(fs.readFileSync(jsonlPath, 'utf-8'));
    _importProgress.totalUnits = incoming.length;

    let existing: any[] = [];
    if (opts.mergeStrategy === 'merge') {
      const dummyVector = new Array(embedding.dimensions).fill(0);
      existing = await store.search(opts.targetLayer, dummyVector, 10000);
    }

    const toImport = applyMergeStrategy(opts.mergeStrategy, incoming, existing);

    for (const unit of toImport) {
      try {
        if (opts.reEmbed || !unit.vector) {
          const [vector] = await embedding.embed([unit.text]);
          unit.vector = vector;
        }
        unit.layer = opts.targetLayer.includes('/') ? 'workspace' : opts.targetLayer;
        await store.add(opts.targetLayer, unit);
        _importProgress.importedUnits++;
      } catch (err) {
        _importProgress.errors.push(`Failed to import unit ${unit.id}: ${err}`);
      }
    }

    _importProgress.status = _importProgress.errors.length > 0 ? 'error' : 'complete';
  } catch (err) {
    _importProgress.status = 'error';
    _importProgress.errors.push(`Import failed: ${err}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { ..._importProgress };
}
