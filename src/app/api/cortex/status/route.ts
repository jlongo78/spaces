import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { isCortexAvailable, getCortex } from '@/lib/cortex';
import { getUserPaths } from '@/lib/config';
import { readCortexConfig } from '@/lib/cortex/config';
import fs from 'fs';
import path from 'path';

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(p);
      else try { total += fs.statSync(p).size; } catch { /* skip */ }
    }
  } catch { /* dir not readable */ }
  return total;
}

export async function GET(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    if (!isCortexAvailable()) {
      return NextResponse.json({ error: 'Cortex unavailable' }, { status: 403 });
    }

    const cortex = await getCortex();
    if (!cortex) {
      return NextResponse.json({ enabled: false, status: 'disabled' });
    }

    const { spacesDir, configPath } = getUserPaths(user);
    const config = readCortexConfig(configPath);
    const cortexDir = path.join(spacesDir, 'cortex');

    // Build workspace ID → name map from DB
    const wsNames = new Map<string, string>();
    try {
      const db = (await import('@/lib/db/schema')).getDb();
      if (db) {
        const rows = db.prepare('SELECT id, name FROM workspaces').all() as { id: number; name: string }[];
        for (const r of rows) wsNames.set(String(r.id), r.name);
      }
    } catch { /* DB not available */ }

    // Scan all lobe directories for sizes and counts
    const lobes: Record<string, { count: number; sizeBytes: number; label: string }> = {};
    const layerDirs = ['personal', 'workspace', 'team'];
    const layerLabels: Record<string, string> = {
      personal: 'Personal',
      workspace: 'Shared (legacy)',
      team: 'Team',
    };

    for (const layer of layerDirs) {
      const layerDir = path.join(cortexDir, layer);
      if (!fs.existsSync(layerDir)) continue;

      // Check if this directory has a knowledge.lance directly
      const lancePath = path.join(layerDir, 'knowledge.lance');
      if (fs.existsSync(lancePath)) {
        try {
          const table = await cortex.store.getTable?.(layer) ?? null;
          const count = table ? await table.countRows() : 0;
          lobes[layer] = { count, sizeBytes: dirSize(layerDir), label: layerLabels[layer] || layer };
        } catch {
          lobes[layer] = { count: 0, sizeBytes: dirSize(layerDir), label: layer };
        }
      }

      // Check for workspace/N subdirectories
      if (layer === 'workspace') {
        try {
          for (const sub of fs.readdirSync(layerDir, { withFileTypes: true })) {
            if (sub.isDirectory() && sub.name !== 'knowledge.lance') {
              const subDir = path.join(layerDir, sub.name);
              const subLance = path.join(subDir, 'knowledge.lance');
              if (fs.existsSync(subLance)) {
                const key = `workspace/${sub.name}`;
                try {
                  const table = await cortex.store.getTable?.(key) ?? null;
                  const count = table ? await table.countRows() : 0;
                  lobes[key] = { count, sizeBytes: dirSize(subDir), label: wsNames.get(sub.name) || `Workspace ${sub.name}` };
                } catch {
                  lobes[key] = { count: 0, sizeBytes: dirSize(subDir), label: wsNames.get(sub.name) || `Workspace ${sub.name}` };
                }
              }
            }
          }
        } catch { /* */ }
      }
    }

    // Read usage stats
    let usage = null;
    const usagePath = path.join(cortexDir, 'usage.json');
    try {
      if (fs.existsSync(usagePath)) usage = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    } catch { /* */ }

    // Total disk usage
    const totalSizeBytes = Object.values(lobes).reduce((sum, l) => sum + l.sizeBytes, 0);
    const totalCount = Object.values(lobes).reduce((sum, l) => sum + l.count, 0);

    // Graph stats
    let graphStats = { entities: 0, edges: 0 };
    try {
      if (cortex.graph) {
        graphStats.entities = cortex.graph.listEntities({}).length;
        graphStats.edges = cortex.graph.listEdges?.({})?.length ?? 0;
      }
    } catch { /* */ }

    return NextResponse.json({
      enabled: true,
      status: 'healthy',
      embedding_provider: cortex.embedding.name,
      embedding_dimensions: cortex.embedding.dimensions,
      distillation: config.ingestion?.distillation ?? false,
      lobes,
      totalCount,
      totalSizeBytes,
      usage,
      graph: graphStats,
    });
  });
}
