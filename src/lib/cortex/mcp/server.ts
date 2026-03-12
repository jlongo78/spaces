// CortexInstance type - will be replaced with import from '../index' in Task 14
export interface CortexInstance {
  config: any;
  store: { add: Function; delete: Function; stats: Function; search: Function; };
  search: { search: Function; };
  pipeline: any;
  embedding: { name: string; dimensions: number; embed(texts: string[]): Promise<number[][]>; };
}

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
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}
