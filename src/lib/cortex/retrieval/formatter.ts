import type { ScoredKnowledge } from '../knowledge/types';
import type { ConflictPair } from './conflict';

const TYPE_LABELS: Record<string, string> = {
  decision: 'Decision', pattern: 'Pattern', preference: 'Preference',
  error_fix: 'Error Fix', context: 'Context', code_pattern: 'Code',
  command: 'Command', conversation: 'Conversation', summary: 'Summary',
};

export interface FormatOptions {
  maxTokens?: number;
}

export function formatContext(
  results: ScoredKnowledge[],
  conflicts: ConflictPair[],
  options: FormatOptions = {},
): string {
  if (results.length === 0) return '';

  const maxTokens = options.maxTokens ?? 2000;
  // Estimate 4 chars per token. Reserve ~50 tokens for wrapper and conflict section.
  const charBudget = maxTokens * 4;

  const entries: string[] = [];
  let usedChars = 0;

  for (const unit of results) {
    const label = TYPE_LABELS[unit.type] ?? unit.type;
    const date = unit.source_timestamp?.slice(0, 10) ?? '';
    const creator = unit.origin?.creator_entity_id;

    let entry = `[${label}]`;
    if (date) entry += ` ${date}`;
    if (creator) entry += ` (${creator})`;
    entry += `: ${unit.text}`;

    if (usedChars + entry.length > charBudget) break;

    entries.push(entry);
    usedChars += entry.length;
  }

  const lines: string[] = ['<cortex-context>', ...entries];

  if (conflicts.length > 0) {
    lines.push('');
    lines.push('Conflicting:');
    for (const { unitA, unitB } of conflicts) {
      lines.push(`- "${unitA.text}" conflicts with "${unitB.text}"`);
    }
  }

  lines.push('</cortex-context>');
  return lines.join('\n');
}
