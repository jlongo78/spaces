import type { ModelUsage } from '@/types/claude';

// Cost rates ($ per 1M tokens) - client-safe, no Node.js imports
const costRates: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-5-20251101': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
};

export function calculateCost(modelUsage: Record<string, ModelUsage>): number {
  let totalCost = 0;

  for (const [model, usage] of Object.entries(modelUsage)) {
    const rates = findRate(model);
    if (!rates) continue;

    totalCost += (usage.inputTokens / 1_000_000) * rates.input;
    totalCost += (usage.outputTokens / 1_000_000) * rates.output;
    totalCost += (usage.cacheReadInputTokens / 1_000_000) * rates.cacheRead;
    totalCost += (usage.cacheCreationInputTokens / 1_000_000) * rates.cacheWrite;
  }

  return Math.round(totalCost * 100) / 100;
}

function findRate(model: string) {
  if (costRates[model]) return costRates[model];

  for (const [key, rates] of Object.entries(costRates)) {
    if (model.startsWith(key.split('-').slice(0, 2).join('-'))) {
      return rates;
    }
  }

  return costRates['claude-sonnet-4-5-20250929'];
}

export function getModelDisplayName(model: string): string {
  if (model.includes('opus-4-6')) return 'Opus 4.6';
  if (model.includes('opus-4-5')) return 'Opus 4.5';
  if (model.includes('sonnet-4-5')) return 'Sonnet 4.5';
  if (model.includes('haiku-4-5')) return 'Haiku 4.5';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('opus')) return 'Opus';
  if (model.includes('haiku')) return 'Haiku';
  return model;
}
