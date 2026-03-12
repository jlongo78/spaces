#!/usr/bin/env node
// Cortex RAG hook for Claude Code (UserPromptSubmit)
// Receives user prompt via stdin JSON, queries Cortex search API,
// returns relevant context as additionalContext.
'use strict';

const http = require('http');

async function main() {
  // Read stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());

  const prompt = input.prompt || '';
  if (prompt.length < 10) process.exit(0);

  const apiPort = process.env.SPACES_PORT || '3457';
  const secret = process.env.SPACES_SESSION_SECRET || '';
  const internalToken = secret.slice(0, 16);
  const query = encodeURIComponent(prompt);
  const url = `http://localhost:${apiPort}/api/cortex/search/?q=${query}&limit=5`;

  let body;
  try {
    body = await new Promise((resolve, reject) => {
      const options = {
        timeout: 5000,
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
  } catch {
    process.exit(0); // Cortex unavailable, don't block the prompt
  }

  const parsed = JSON.parse(body);
  const results = parsed.results;
  if (!results || results.length === 0) process.exit(0);

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
