#!/usr/bin/env node
// Cortex RAG hook for Claude Code (UserPromptSubmit)
// Receives user prompt via stdin JSON, queries Cortex search API,
// returns relevant context as additionalContext.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

function readSpacesEnv() {
  const candidates = [
    path.join(process.cwd(), '.claude', 'spaces-env.json'),
  ];
  if (process.env.CLAUDE_PROJECT_DIR) {
    candidates.unshift(path.join(process.env.CLAUDE_PROJECT_DIR, '.claude', 'spaces-env.json'));
  }
  for (const envFile of candidates) {
    try {
      if (fs.existsSync(envFile)) {
        return JSON.parse(fs.readFileSync(envFile, 'utf-8'));
      }
    } catch { /* */ }
  }
  return {};
}

async function main() {
  // Read stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());

  const prompt = input.prompt || '';
  if (prompt.length < 10) process.exit(0);
  const spacesEnv = readSpacesEnv();
  const apiPort = process.env.SPACES_PORT || '3457';
  const secret = process.env.SPACES_SESSION_SECRET || '';
  const internalToken = secret.slice(0, 16);
  const workspaceId = process.env.SPACES_WORKSPACE_ID || spacesEnv.workspaceId || '';
  process.stderr.write(`[Cortex RAG] Query: ${prompt.slice(0, 80)}...\n`);
  process.stderr.write(`[Cortex RAG] env: port=${apiPort} ws=${workspaceId || 'NONE'} token=${internalToken ? internalToken.slice(0,4) + '...' : 'EMPTY'}\n`);
  const query = encodeURIComponent(prompt);
  const wsParam = workspaceId ? `&workspace_id=${workspaceId}` : '';
  const url = `http://localhost:${apiPort}/api/cortex/context/?q=${query}&limit=5${wsParam}`;

  let body;
  try {
    body = await new Promise((resolve, reject) => {
      const options = {
        timeout: 3000,
        headers: { 'x-spaces-internal': internalToken },
      };
      const req = http.get(url, options, (res) => {
        // Follow one redirect (Next.js trailing-slash)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location.startsWith('http')
            ? res.headers.location
            : `http://localhost:${apiPort}${res.headers.location}`;
          http.get(loc, options, (res2) => {
            let d = '';
            res2.on('data', c => d += c);
            res2.on('end', () => res2.statusCode === 200 ? resolve(d) : reject(new Error(`${res2.statusCode}`)));
          }).on('error', reject);
          return;
        }
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => res.statusCode === 200 ? resolve(d) : reject(new Error(`${res.statusCode}`)));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
  } catch (err) {
    process.stderr.write(`[Cortex RAG] Failed: ${err.message || err}\n`);
    process.exit(0); // Cortex unavailable, don't block the prompt
  }

  const parsed = JSON.parse(body);

  // New primary path: context assembly endpoint returns pre-formatted context
  if (parsed.context) {
    const ctxLines = parsed.context.split('\n').filter(l => l.trim()).length;
    process.stderr.write(`[Cortex RAG] Retrieved ${parsed.results?.length || 0} results, ${ctxLines} context lines (${parsed.timing?.totalMs || '?'}ms)\n`);
    if (parsed.results) {
      for (const r of parsed.results.slice(0, 3)) {
        process.stderr.write(`[Cortex RAG]   → [${r.type}] ${r.text.slice(0, 60)}...\n`);
      }
    }
    const output = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: parsed.context,
      },
    });
    process.stdout.write(output);
    process.exit(0);
  }

  // Fallback: old-style formatting from parsed.results (backward compat)
  const results = parsed.results;
  if (!results || results.length === 0) {
    process.stderr.write(`[Cortex RAG] No results found\n`);
    process.exit(0);
  }
  process.stderr.write(`[Cortex RAG] Retrieved ${results.length} results (fallback path)\n`);

  // Format results
  const TYPE_LABELS = {
    decision: 'Decision', pattern: 'Pattern', preference: 'Preference',
    error_fix: 'Error Fix', context: 'Context', code_pattern: 'Code',
    command: 'Command', conversation: 'Conversation', summary: 'Summary',
  };

  const entries = [];
  let tokens = 20;
  for (const unit of results) {
    const label = TYPE_LABELS[unit.type] || unit.type;
    const date = (unit.source_timestamp || '').slice(0, 10);
    let entry = `[${label}]`;
    if (date) entry += ` ${date}:`;
    entry += ` ${unit.text}`;
    const entryTokens = Math.ceil(entry.length / 4);
    if (tokens + entryTokens > 1500) break;
    entries.push(entry);
    tokens += entryTokens;
  }

  if (entries.length === 0) process.exit(0);

  const context = [
    '<cortex-context>',
    'Relevant knowledge from your workspace history:',
    '',
    ...entries,
    '</cortex-context>',
  ].join('\n');

  const output = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  });

  process.stdout.write(output);
  process.exit(0);
}

main().catch(() => process.exit(0));
