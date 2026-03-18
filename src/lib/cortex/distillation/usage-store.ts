import fs from 'fs';
import path from 'path';
import type { LLMUsage } from './llm';

// Per-million token pricing
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
};

export interface UsageRecord {
  input_tokens: number;
  output_tokens: number;
  calls: number;
  estimated_cost_usd: number;
  last_updated: string;
}

export interface CortexUsage {
  distillation: UsageRecord;
  by_model: Record<string, UsageRecord>;
}

function costFor(model: string, input: number, output: number): number {
  const p = PRICING[model] ?? { input: 1.0, output: 5.0 };
  return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
}

export function recordUsage(usagePath: string, usage: LLMUsage): void {
  let current: CortexUsage = {
    distillation: { input_tokens: 0, output_tokens: 0, calls: 0, estimated_cost_usd: 0, last_updated: '' },
    by_model: {},
  };
  try {
    if (fs.existsSync(usagePath)) {
      current = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    }
  } catch { /* start fresh */ }

  const cost = costFor(usage.model, usage.input_tokens, usage.output_tokens);
  const now = new Date().toISOString();

  current.distillation.input_tokens += usage.input_tokens;
  current.distillation.output_tokens += usage.output_tokens;
  current.distillation.calls += 1;
  current.distillation.estimated_cost_usd += cost;
  current.distillation.last_updated = now;

  if (!current.by_model[usage.model]) {
    current.by_model[usage.model] = { input_tokens: 0, output_tokens: 0, calls: 0, estimated_cost_usd: 0, last_updated: '' };
  }
  const m = current.by_model[usage.model];
  m.input_tokens += usage.input_tokens;
  m.output_tokens += usage.output_tokens;
  m.calls += 1;
  m.estimated_cost_usd += cost;
  m.last_updated = now;

  try {
    const dir = path.dirname(usagePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(usagePath, JSON.stringify(current, null, 2));
  } catch { /* non-fatal */ }
}

export function readUsage(usagePath: string): CortexUsage {
  try {
    if (fs.existsSync(usagePath)) {
      return JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {
    distillation: { input_tokens: 0, output_tokens: 0, calls: 0, estimated_cost_usd: 0, last_updated: '' },
    by_model: {},
  };
}
