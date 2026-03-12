import { describe, it, expect } from 'vitest';
import { CORTEX_TOOLS, handleToolCall } from '@/lib/cortex/mcp/server';

describe('MCP server', () => {
  it('defines 4 core tools', () => {
    expect(CORTEX_TOOLS).toHaveLength(4);
    const names = CORTEX_TOOLS.map(t => t.name);
    expect(names).toContain('cortex_search');
    expect(names).toContain('cortex_teach');
    expect(names).toContain('cortex_forget');
    expect(names).toContain('cortex_status');
  });

  it('cortex_search requires query param', () => {
    const tool = CORTEX_TOOLS.find(t => t.name === 'cortex_search')!;
    expect(tool.inputSchema.required).toContain('query');
  });

  it('cortex_teach requires text, type, layer', () => {
    const tool = CORTEX_TOOLS.find(t => t.name === 'cortex_teach')!;
    expect(tool.inputSchema.required).toEqual(['text', 'type', 'layer']);
  });

  it('returns error for unknown tool', async () => {
    const result = await handleToolCall('unknown_tool', {}, null);
    expect(result.isError).toBe(true);
  });

  it('handles cortex_status without cortex instance', async () => {
    const result = await handleToolCall('cortex_status', {}, null);
    expect(result.content[0].text).toContain('not initialized');
  });
});
