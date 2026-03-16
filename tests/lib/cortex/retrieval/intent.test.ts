import { describe, it, expect } from 'vitest';
import { detectIntent, INTENTS } from '@/lib/cortex/retrieval/intent';

describe('detectIntent', () => {
  it('detects debugging intent', () => {
    const result = detectIntent('why does the auth service throw a timeout error?');
    expect(result.intent).toBe('debugging');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('detects architecture intent', () => {
    const result = detectIntent('what architecture pattern should we use?');
    expect(result.intent).toBe('architecture');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('detects how-to intent', () => {
    const result = detectIntent('how do I deploy this service?');
    expect(result.intent).toBe('how-to');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('detects security intent', () => {
    const result = detectIntent('is there a vulnerability in authentication?');
    expect(result.intent).toBe('security');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('defaults to general for ambiguous queries', () => {
    const result = detectIntent('tell me about the project');
    expect(result.intent).toBe('general');
    expect(result.confidence).toBe(0);
  });

  it('returns bias config with the detected intent', () => {
    const result = detectIntent('why does the auth service throw a timeout error?');
    expect(result.biases).toBeDefined();
    expect(result.biases.scope_boost).toBeDefined();
    expect(result.biases.type_boost).toBeDefined();
    expect(typeof result.biases.recency_boost).toBe('number');
  });

  it('exports all 8 intent definitions', () => {
    const intentNames = Object.keys(INTENTS);
    expect(intentNames).toHaveLength(8);
    expect(intentNames).toContain('debugging');
    expect(intentNames).toContain('architecture');
    expect(intentNames).toContain('onboarding');
    expect(intentNames).toContain('policy');
    expect(intentNames).toContain('how-to');
    expect(intentNames).toContain('review');
    expect(intentNames).toContain('security');
    expect(intentNames).toContain('general');
  });
});
