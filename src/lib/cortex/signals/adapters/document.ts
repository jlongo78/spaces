import { readdirSync, statSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import type { SignalAdapter, SignalEnvelope } from '../types';
import type { KnowledgeType } from '@/lib/cortex/knowledge/types';

const MAX_CONTENT_LENGTH = 4000;

export function classifyDocument(filepath: string): KnowledgeType {
  const lower = filepath.toLowerCase();
  if (/adr/.test(lower)) return 'decision';
  if (/runbook|playbook/.test(lower)) return 'pattern';
  if (/readme|guide/.test(lower)) return 'context';
  if (/changelog/.test(lower)) return 'summary';
  return 'context';
}

export function parseDocument(input: { path: string; content: string }): SignalEnvelope {
  const truncated = input.content.slice(0, MAX_CONTENT_LENGTH);
  return {
    text: truncated,
    origin: {
      source_type: 'document',
      source_ref: input.path,
      creator_entity_id: 'person-default-user',
    },
    entities: [],
    suggested_type: classifyDocument(input.path),
    suggested_sensitivity: 'internal',
    raw_metadata: {
      path: input.path,
      authority_boost: true,
    },
  };
}

function walkMdFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...walkMdFiles(full));
    } else if (extname(entry).toLowerCase() === '.md') {
      results.push(full);
    }
  }
  return results;
}

export class DocumentAdapter implements SignalAdapter {
  name = 'document';
  schedule = 'polling' as const;

  constructor(private readonly docPaths: string[]) {}

  async *extract(): AsyncIterable<SignalEnvelope> {
    for (const docPath of this.docPaths) {
      let stat;
      try {
        stat = statSync(docPath);
      } catch {
        continue;
      }

      const files = stat.isDirectory() ? walkMdFiles(docPath) : [docPath];

      for (const file of files) {
        let content: string;
        try {
          content = readFileSync(file, 'utf-8');
        } catch {
          continue;
        }
        yield parseDocument({ path: file, content });
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    for (const docPath of this.docPaths) {
      try {
        const stat = statSync(docPath);
        if (stat.isDirectory()) return true;
      } catch {
        // continue
      }
    }
    return false;
  }
}
