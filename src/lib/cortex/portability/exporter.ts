import fs from 'fs';
import path from 'path';
import tar from 'tar';
import type { CortexStore } from '../store';
import type { KnowledgeUnit } from '../knowledge/types';

export interface ExportManifest {
  version: string;
  exportDate: string;
  scope: string;
  unitCount: number;
  includeEmbeddings: boolean;
  sourceNode?: string;
}

export function createManifest(opts: {
  scope: string;
  unitCount: number;
  includeEmbeddings: boolean;
  sourceNode?: string;
}): ExportManifest {
  return {
    version: '1.0.0',
    exportDate: new Date().toISOString(),
    scope: opts.scope,
    unitCount: opts.unitCount,
    includeEmbeddings: opts.includeEmbeddings,
    sourceNode: opts.sourceNode,
  };
}

export function serializeKnowledgeToJSONL(units: KnowledgeUnit[]): string {
  return units.map(u => {
    const { vector, ...rest } = u;
    return JSON.stringify(rest);
  }).join('\n') + '\n';
}

export async function exportCortexpack(
  store: CortexStore,
  outputPath: string,
  opts: {
    scope: 'full' | 'workspace' | 'personal';
    workspaceId?: number;
    includeEmbeddings?: boolean;
  },
): Promise<{ path: string; unitCount: number }> {
  const tmpDir = `${outputPath}.tmp`;
  fs.mkdirSync(tmpDir, { recursive: true });

  const layers = opts.scope === 'personal'
    ? ['personal']
    : opts.scope === 'workspace' && opts.workspaceId
      ? [`workspace/${opts.workspaceId}`]
      : ['personal', 'workspace', 'team'];

  const allUnits: KnowledgeUnit[] = [];
  for (const layer of layers) {
    const dummyVector = new Array(384).fill(0);
    const units = await store.search(layer, dummyVector, 10000);
    allUnits.push(...units);
  }

  const manifest = createManifest({
    scope: opts.scope,
    unitCount: allUnits.length,
    includeEmbeddings: opts.includeEmbeddings ?? false,
  });
  fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(tmpDir, 'knowledge.jsonl'), serializeKnowledgeToJSONL(allUnits));

  await tar.create(
    { gzip: true, file: outputPath, cwd: tmpDir },
    ['manifest.json', 'knowledge.jsonl'],
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });

  return { path: outputPath, unitCount: allUnits.length };
}
