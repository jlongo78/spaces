#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const http = require('http');

const fs = require('fs');
const { spacesHome } = require('./lib/spaces-home');

// Pane-specific identity comes from the parent process (Claude Code) which
// inherits env from the PTY.  Claude Code isolates MCP server env to only
// what's in .mcp.json, so we read the parent's env directly via /proc.
function readParentEnv(name) {
  try {
    const ppid = process.ppid;
    const raw = fs.readFileSync(`/proc/${ppid}/environ`, 'utf8');
    const match = raw.split('\0').find(e => e.startsWith(name + '='));
    return match ? match.slice(name.length + 1) : undefined;
  } catch {
    return undefined;
  }
}

const API_URL = process.env.SPACES_API_URL || readParentEnv('SPACES_API_URL') || 'http://localhost:3457';
const WORKSPACE_ID = process.env.SPACES_WORKSPACE_ID || readParentEnv('SPACES_WORKSPACE_ID');
const PANE_ID = readParentEnv('SPACES_PANE_ID') || process.env.SPACES_PANE_ID;
const PANE_NAME = readParentEnv('SPACES_PANE_NAME') || process.env.SPACES_PANE_NAME || 'Claude';
const BASE_PATH = process.env.SPACES_BASE_PATH ?? readParentEnv('SPACES_BASE_PATH') ?? '';
// A short-lived token signed with the owner's secret, minted per request
// and sent only to this machine's loopback: a project's .mcp.json can name
// any SPACES_API_URL, and the owner's credentials must not follow it.
const SECRET = process.env.SPACES_INTERNAL_TOKEN || readParentEnv('SPACES_INTERNAL_TOKEN')
  || require('./lib/desktop-auth').readSecret(spacesHome());

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_URL}${BASE_PATH}${path}`);
    const headers = { 'Content-Type': 'application/json' };
    Object.assign(headers, require('./lib/desktop-auth').clientAuthHeaders(API_URL, SECRET));
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const server = new Server(
    { name: 'spaces-bus', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'post_message',
        description: 'Post a message to the workspace message bus. Other agents and the human can see it.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The message content' },
            target_pane_name: { type: 'string', description: 'Optional: direct this message to a specific agent by name' },
          },
          required: ['content'],
        },
      },
      {
        name: 'read_messages',
        description: 'Read recent messages from the workspace message bus.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max messages to return (default 20)' },
            since_minutes: { type: 'number', description: 'Only messages from the last N minutes' },
          },
        },
      },
      {
        name: 'request_help',
        description: 'Post a request to the workspace that requires human approval before delivery. Use this when you need another agent to do something.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'What you need help with' },
            target_pane_name: { type: 'string', description: 'Which agent should handle this' },
          },
          required: ['content'],
        },
      },
      {
        name: 'get_context',
        description: 'Read shared workspace context entries. These are key-value pairs shared between all agents.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Specific key to read (omit for all entries)' },
          },
        },
      },
      {
        name: 'set_context',
        description: 'Write a shared workspace context entry visible to all agents.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The context key' },
            value: { type: 'string', description: 'The context value' },
          },
          required: ['key', 'value'],
        },
      },
      {
        name: 'list_agents',
        description: 'List all active agents in the current workspace.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (!WORKSPACE_ID) {
      return { content: [{ type: 'text', text: 'Error: Not running inside a Spaces workspace.' }] };
    }

    switch (name) {
      case 'post_message': {
        const msg = await apiRequest('POST', `/api/workspaces/${WORKSPACE_ID}/messages/`, {
          content: args.content,
          senderName: PANE_NAME,
          paneId: PANE_ID,
          type: 'message',
          isAgent: true,
          ...(args.target_pane_name && { metadata: { targetName: args.target_pane_name } }),
        });
        return { content: [{ type: 'text', text: `Message posted: "${msg.content}"` }] };
      }

      case 'read_messages': {
        const sp = new URLSearchParams();
        if (args.limit) sp.set('limit', String(args.limit));
        if (args.since_minutes) {
          sp.set('since', new Date(Date.now() - args.since_minutes * 60000).toISOString());
        }
        const messages = await apiRequest('GET', `/api/workspaces/${WORKSPACE_ID}/messages/?${sp}`);
        if (!Array.isArray(messages) || messages.length === 0) {
          return { content: [{ type: 'text', text: 'No messages in the workspace.' }] };
        }
        const formatted = messages.reverse().map(m => {
          const status = m.status !== 'delivered' ? ` [${m.status}]` : '';
          return `[${new Date(m.created).toLocaleTimeString()}] ${m.senderName}: ${m.content}${status}`;
        }).join('\n');
        return { content: [{ type: 'text', text: formatted }] };
      }

      case 'request_help': {
        const msg = await apiRequest('POST', `/api/workspaces/${WORKSPACE_ID}/messages/`, {
          content: args.content,
          senderName: PANE_NAME,
          paneId: PANE_ID,
          type: 'request',
          isAgent: true,
          ...(args.target_pane_name && { metadata: { targetName: args.target_pane_name } }),
        });
        return { content: [{ type: 'text', text: `Request posted (awaiting human approval): "${msg.content}"` }] };
      }

      case 'get_context': {
        if (args.key) {
          const entry = await apiRequest('GET', `/api/workspaces/${WORKSPACE_ID}/context/${encodeURIComponent(args.key)}/`);
          if (!entry || !entry.value) {
            return { content: [{ type: 'text', text: `No context entry found for key: ${args.key}` }] };
          }
          return { content: [{ type: 'text', text: `${args.key} = ${entry.value} (set by ${entry.updatedBy})` }] };
        }
        const entries = await apiRequest('GET', `/api/workspaces/${WORKSPACE_ID}/context/`);
        if (!Array.isArray(entries) || entries.length === 0) {
          return { content: [{ type: 'text', text: 'No shared context entries.' }] };
        }
        const formatted = entries.map(e => `${e.key} = ${e.value} (by ${e.updatedBy})`).join('\n');
        return { content: [{ type: 'text', text: formatted }] };
      }

      case 'set_context': {
        await apiRequest('PUT', `/api/workspaces/${WORKSPACE_ID}/context/${encodeURIComponent(args.key)}/`, {
          value: args.value,
          updatedBy: PANE_NAME,
        });
        return { content: [{ type: 'text', text: `Context set: ${args.key} = ${args.value}` }] };
      }

      case 'list_agents': {
        const panes = await apiRequest('GET', `/api/panes/`);
        if (!Array.isArray(panes)) {
          return { content: [{ type: 'text', text: 'Could not fetch panes.' }] };
        }
        const inWorkspace = panes.filter(p => String(p.workspaceId) === WORKSPACE_ID);
        if (inWorkspace.length === 0) {
          return { content: [{ type: 'text', text: 'No agents in this workspace.' }] };
        }
        const formatted = inWorkspace.map(p => {
          const me = p.id === PANE_ID ? ' (you)' : '';
          return `${p.title} [${p.agentType || 'shell'}]${me}`;
        }).join('\n');
        return { content: [{ type: 'text', text: formatted }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
