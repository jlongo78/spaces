#!/usr/bin/env node
// Cortex Learn hook for Claude Code (Stop)
// After Claude finishes responding, reads the last Q&A exchange from
// the transcript and ingests it back into Cortex as new knowledge.
'use strict';

const http = require('http');
const fs = require('fs');
const readline = require('readline');

async function main() {
  // Read stdin for hook input
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());

  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

  // Read the last few lines of the transcript to find the last Q&A exchange
  const lastExchange = await extractLastExchange(transcriptPath);
  if (!lastExchange || !lastExchange.question || !lastExchange.answer) process.exit(0);

  // Skip trivial exchanges (very short answers aren't worth learning)
  if (lastExchange.answer.length < 100) process.exit(0);

  // Classify the exchange type with simple heuristics
  const knowledgeType = classifyExchange(lastExchange.question, lastExchange.answer);

  // Build the knowledge text: combine Q&A into a learnable unit
  const text = `Q: ${lastExchange.question}\nA: ${lastExchange.answer}`;

  // Truncate to avoid excessively large entries (keep to ~2000 chars)
  const truncatedText = text.length > 2000 ? text.slice(0, 2000) + '...' : text;

  // POST to Cortex knowledge API
  const apiPort = process.env.SPACES_PORT || '3457';
  const secret = process.env.SPACES_SESSION_SECRET || '';
  const internalToken = secret.slice(0, 16);

  const payload = JSON.stringify({
    text: truncatedText,
    type: knowledgeType,
    layer: 'personal',
  });

  try {
    await postToApi(apiPort, internalToken, '/api/cortex/knowledge/', payload);
  } catch {
    // Don't block Claude — learning failure is non-critical
  }

  process.exit(0);
}

// Read the JSONL transcript and extract the last user→assistant exchange
async function extractLastExchange(transcriptPath) {
  const lines = [];

  // Read only the last 100 lines to avoid parsing huge transcripts
  const fileStream = fs.createReadStream(transcriptPath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.trim()) lines.push(line.trim());
    if (lines.length > 200) lines.shift();
  }

  let lastUserMsg = null;
  let lastAssistantMsg = null;

  // Walk backwards to find the last assistant message and the user message before it
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);

      if (!lastAssistantMsg && entry.type === 'assistant') {
        // Extract text from assistant message
        const text = extractText(entry);
        if (text) lastAssistantMsg = text;
      } else if (lastAssistantMsg && !lastUserMsg && entry.type === 'human') {
        const text = extractText(entry);
        if (text) lastUserMsg = text;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!lastUserMsg || !lastAssistantMsg) return null;
  return { question: lastUserMsg, answer: lastAssistantMsg };
}

// Extract plain text from a transcript message entry
function extractText(entry) {
  if (typeof entry.message === 'string') return entry.message;
  if (entry.message && typeof entry.message.content === 'string') return entry.message.content;
  if (entry.message && Array.isArray(entry.message.content)) {
    return entry.message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
  }
  // Direct content field
  if (typeof entry.content === 'string') return entry.content;
  if (Array.isArray(entry.content)) {
    return entry.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
  }
  return null;
}

// Simple heuristic classification of the exchange
function classifyExchange(question, answer) {
  const q = question.toLowerCase();
  const a = answer.toLowerCase();

  if (q.includes('fix') || q.includes('error') || q.includes('bug') || q.includes('broken') ||
      a.includes('root cause') || a.includes('the fix') || a.includes('was caused by')) {
    return 'error_fix';
  }
  if (q.includes('how do') || q.includes('how to') || q.includes('how does') || q.includes('what is') ||
      q.includes('explain') || q.includes('where is')) {
    return 'context';
  }
  if (q.includes('should we') || q.includes('which approach') || q.includes('decide') ||
      a.includes('i recommend') || a.includes('the best approach')) {
    return 'decision';
  }
  if (a.includes('pattern') || a.includes('convention') || a.includes('always use') ||
      a.includes('the standard') || a.includes('best practice')) {
    return 'pattern';
  }
  if (a.includes('```') || a.includes('function ') || a.includes('import ') || a.includes('class ')) {
    return 'code_pattern';
  }
  return 'conversation';
}

function postToApi(port, token, apiPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: parseInt(port),
      path: apiPath,
      method: 'POST',
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'x-spaces-internal': token,
      },
    };
    const req = http.request(options, (res) => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const loc = res.headers.location;
        options.path = loc.startsWith('http') ? new URL(loc).pathname : loc;
        const req2 = http.request(options, (res2) => {
          let d = '';
          res2.on('data', c => d += c);
          res2.on('end', () => res2.statusCode < 300 ? resolve(d) : reject(new Error(`${res2.statusCode}`)));
        });
        req2.on('error', reject);
        req2.write(body);
        req2.end();
        return;
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => res.statusCode < 300 ? resolve(d) : reject(new Error(`${res.statusCode}`)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

main().catch(() => process.exit(0));
