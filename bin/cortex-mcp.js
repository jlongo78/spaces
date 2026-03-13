#!/usr/bin/env node
'use strict';

const readline = require('readline');

const SPACES_URL = process.env.SPACES_URL || 'http://localhost:3457';
const INTERNAL_TOKEN = process.env.SPACES_INTERNAL_TOKEN || '';

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.method === 'initialize') {
    respond(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'cortex', version: '1.0.0' },
    });
    return;
  }

  if (msg.method === 'notifications/initialized') return;

  if (msg.method === 'tools/list') {
    const tools = await fetchJSON('/api/cortex/mcp/tools');
    respond(msg.id, { tools: tools || [] });
    return;
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params;
    const result = await fetchJSON('/api/cortex/mcp/call', {
      method: 'POST',
      body: JSON.stringify({ name, args }),
    });
    respond(msg.id, result || { content: [{ type: 'text', text: 'Error calling tool' }], isError: true });
    return;
  }

  respond(msg.id, null, { code: -32601, message: `Method not found: ${msg.method}` });
});

function respond(id, result, error) {
  const msg = { jsonrpc: '2.0', id };
  if (error) msg.error = error;
  else msg.result = result;
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function fetchJSON(path, opts = {}) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (INTERNAL_TOKEN) headers['x-spaces-internal'] = INTERNAL_TOKEN;
    const res = await fetch(`${SPACES_URL}${path}`, { ...opts, headers: { ...headers, ...opts.headers } });
    if (res.ok) return await res.json();
    return null;
  } catch { return null; }
}
