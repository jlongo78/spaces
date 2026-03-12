import type { ScoredKnowledge } from '../knowledge/types';

const TYPE_LABELS: Record<string, string> = {
  decision: 'Decision',
  pattern: 'Pattern',
  preference: 'Preference',
  error_fix: 'Error Fix',
  context: 'Context',
  code_pattern: 'Code',
  command: 'Command',
  conversation: 'Conversation',
  summary: 'Summary',
};

export function formatCortexContext(
  results: ScoredKnowledge[],
  maxTokens = 2000,
): string {
  if (results.length === 0) return '';

  const lines: string[] = ['<cortex-context>', 'Relevant context from your workspace history:', ''];
  let estimatedTokens = 20;

  for (const unit of results) {
    const label = TYPE_LABELS[unit.type] || unit.type;
    const date = unit.source_timestamp?.slice(0, 10) || '';
    const confidence = (unit.confidence * 100).toFixed(0);

    let entry = `[${label}]`;
    if (date) entry += ` ${date}:`;
    entry += ` ${unit.text}`;

    if (unit.session_id) {
      entry += `\nSource: session ${unit.session_id}, confidence: ${confidence}%`;
    }

    const entryTokens = Math.ceil(entry.length / 4);
    if (estimatedTokens + entryTokens > maxTokens) break;

    lines.push(entry);
    lines.push('');
    estimatedTokens += entryTokens;
  }

  lines.push('</cortex-context>');
  return lines.join('\n');
}
