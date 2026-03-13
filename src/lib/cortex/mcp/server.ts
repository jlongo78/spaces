import type { CortexInstance } from '../index';
export type { CortexInstance };

export const CORTEX_TOOLS = [
  {
    name: 'cortex_search',
    description: 'Search the Cortex knowledge base for relevant context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        layers: { type: 'array', items: { type: 'string' }, description: 'Layers to search' },
        types: { type: 'array', items: { type: 'string' }, description: 'Filter by type' },
        workspace_id: { type: 'number', description: 'Workspace ID' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cortex_teach',
    description: 'Explicitly teach the Cortex something.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Knowledge to store' },
        type: { type: 'string', description: 'Type: decision, pattern, preference, error_fix' },
        layer: { type: 'string', description: 'Layer: personal, workspace, team' },
        workspace_id: { type: 'number', description: 'Workspace ID if workspace layer' },
      },
      required: ['text', 'type', 'layer'],
    },
  },
  {
    name: 'cortex_forget',
    description: 'Remove or downrank knowledge from the Cortex.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Knowledge unit ID' },
        action: { type: 'string', enum: ['delete', 'downrank'], description: 'Delete or downrank' },
      },
      required: ['id'],
    },
  },
  {
    name: 'cortex_status',
    description: 'Get Cortex health and statistics.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'cortex_recall',
    description: 'Retrieve a specific knowledge unit by ID or exact text match.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Knowledge unit ID' },
        text: { type: 'string', description: 'Exact text to match' },
      },
    },
  },
  {
    name: 'cortex_similar',
    description: 'Find analogous experiences or knowledge similar to the given text.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to find similarities for' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'cortex_context',
    description: 'Get full workspace context including all relevant knowledge for a workspace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: { type: 'number', description: 'Workspace ID' },
        depth: { type: 'string', enum: ['brief', 'full'], description: 'brief=10 results, full=50 results' },
      },
      required: ['workspace_id'],
    },
  },
  {
    name: 'cortex_timeline',
    description: 'Get chronological history of decisions, patterns, and changes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        workspace_id: { type: 'number', description: 'Workspace ID to scope timeline' },
        project_path: { type: 'string', description: 'Project path to scope timeline' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
  },
  {
    name: 'cortex_export',
    description: 'Export Cortex knowledge to a portable .cortexpack file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', enum: ['full', 'workspace', 'personal'], description: 'Export scope (default full)' },
        workspace_id: { type: 'number', description: 'Workspace ID for workspace scope' },
        include_embeddings: { type: 'boolean', description: 'Include raw embedding vectors' },
      },
    },
  },
  {
    name: 'cortex_import',
    description: 'Import knowledge from a .cortexpack file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to the .cortexpack file' },
        target_layer: { type: 'string', description: 'Layer to import into' },
        merge_strategy: { type: 'string', enum: ['append', 'merge', 'replace'], description: 'How to handle conflicts (default append)' },
        re_embed: { type: 'boolean', description: 'Re-generate embeddings on import' },
      },
      required: ['path'],
    },
  },
];

export async function handleToolCall(
  name: string,
  args: Record<string, any>,
  cortex: CortexInstance | null,
) {
  if (!cortex) {
    if (name === 'cortex_status') {
      return { content: [{ type: 'text', text: JSON.stringify({ status: 'not initialized' }) }] };
    }
    return { content: [{ type: 'text', text: 'Cortex not initialized' }], isError: true };
  }

  switch (name) {
    case 'cortex_search': {
      const [queryVector] = await cortex.embedding.embed([args.query]);
      const results = await cortex.search.search(queryVector, {
        workspaceId: args.workspace_id ?? null,
        limit: args.limit ?? 5,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    }
    case 'cortex_teach': {
      const crypto = await import('crypto');
      const [vector] = await cortex.embedding.embed([args.text]);
      const layerKey = args.layer === 'workspace' && args.workspace_id
        ? `workspace/${args.workspace_id}` : args.layer;
      await cortex.store.add(layerKey, {
        id: crypto.randomUUID(), vector, text: args.text, type: args.type,
        layer: args.layer, workspace_id: args.workspace_id ?? null,
        session_id: null, agent_type: 'claude', project_path: null,
        file_refs: [], confidence: 0.95,
        created: new Date().toISOString(), source_timestamp: new Date().toISOString(),
        stale_score: 0, access_count: 0, last_accessed: null,
        metadata: { source: 'mcp_teach' },
      });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    }
    case 'cortex_forget': {
      const action = args.action ?? 'delete';
      if (action === 'delete') {
        for (const layer of ['personal', 'workspace', 'team']) {
          await cortex.store.delete(layer, args.id);
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
    }
    case 'cortex_status': {
      const stats = await cortex.store.stats();
      return { content: [{ type: 'text', text: JSON.stringify({
        status: 'healthy', embedding: cortex.embedding.name, layers: stats,
      }) }] };
    }
    case 'cortex_recall': {
      if (!args.id && !args.text) {
        return { content: [{ type: 'text', text: 'Either id or text must be provided' }], isError: true };
      }
      if (args.id) {
        const safeId = String(args.id).replace(/'/g, "''");
        const dummyVector = new Array(cortex.embedding.dimensions).fill(0);
        const results: any[] = [];
        for (const layer of ['personal', 'workspace', 'team']) {
          const layerResults = await cortex.store.search(layer, dummyVector, 1, `id = '${safeId}'`);
          results.push(...layerResults);
        }
        return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
      } else {
        const [textVector] = await cortex.embedding.embed([args.text]);
        const results = await cortex.search.search(textVector, { limit: 1 });
        return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
      }
    }
    case 'cortex_similar': {
      const [textVector] = await cortex.embedding.embed([args.text]);
      const results = await cortex.search.search(textVector, {
        limit: args.limit ?? 5,
      });
      return { content: [{ type: 'text', text: JSON.stringify({ results }) }] };
    }
    case 'cortex_context': {
      const limit = args.depth === 'full' ? 50 : 10;
      const dummyVector = new Array(cortex.embedding.dimensions).fill(0);
      const layerKey = `workspace/${args.workspace_id}`;
      const results = await cortex.store.search(layerKey, dummyVector, limit);
      const sorted = Array.isArray(results)
        ? results.sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0))
        : results;
      return { content: [{ type: 'text', text: JSON.stringify({ results: sorted }) }] };
    }
    case 'cortex_timeline': {
      const limit = args.limit ?? 20;
      const timelineTypes = ['decision', 'pattern', 'error_fix', 'summary'];
      const dummyVector = new Array(cortex.embedding.dimensions).fill(0);
      let layerKey: string;
      if (args.workspace_id) {
        layerKey = `workspace/${args.workspace_id}`;
      } else {
        layerKey = 'personal';
      }
      const raw = await cortex.store.search(layerKey, dummyVector, limit * 4);
      const filtered = Array.isArray(raw)
        ? raw.filter((r: any) => timelineTypes.includes(r.type))
            .sort((a: any, b: any) => {
              const ta = a.source_timestamp ?? a.created ?? '';
              const tb = b.source_timestamp ?? b.created ?? '';
              return tb.localeCompare(ta);
            })
            .slice(0, limit)
        : raw;
      return { content: [{ type: 'text', text: JSON.stringify({ results: filtered }) }] };
    }
    case 'cortex_export': {
      try {
        const { exportCortexpack } = await import('../portability/exporter');
        const os = await import('os');
        const pathModule = await import('path');
        const outputPath = pathModule.join(
          os.tmpdir(),
          `cortex-export-${Date.now()}.cortexpack`,
        );
        const result = await exportCortexpack(cortex.store, outputPath, {
          scope: args.scope ?? 'full',
          workspaceId: args.workspace_id,
          includeEmbeddings: args.include_embeddings ?? false,
          dimensions: cortex.embedding.dimensions,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ path: result.path, unitCount: result.unitCount }) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err?.message ?? String(err) }) }], isError: true };
      }
    }
    case 'cortex_import': {
      try {
        const { importCortexpack } = await import('../portability/importer');
        const progress = await importCortexpack(args.path, cortex.store, cortex.embedding, {
          targetLayer: args.target_layer ?? 'personal',
          mergeStrategy: args.merge_strategy ?? 'append',
          reEmbed: args.re_embed ?? false,
        });
        return { content: [{ type: 'text', text: JSON.stringify(progress) }] };
      } catch (err: any) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: err?.message ?? String(err) }) }], isError: true };
      }
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}
