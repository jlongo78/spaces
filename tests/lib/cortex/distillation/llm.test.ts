import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCallLLM, detectLLMProvider } from '@/lib/cortex/distillation/llm';

describe('detectLLMProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it('detects anthropic when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(detectLLMProvider()).toBe('anthropic');
  });

  it('detects openai when OPENAI_API_KEY is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(detectLLMProvider()).toBe('openai');
  });

  it('returns null when no keys are set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(detectLLMProvider()).toBeNull();
  });
});

describe('createCallLLM', () => {
  it('returns null when no provider available', () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    expect(createCallLLM()).toBeNull();
  });
});
