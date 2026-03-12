import { describe, it, expect } from 'vitest';
import { parseKnowledgeJSONL, applyMergeStrategy } from '@/lib/cortex/portability/importer';

describe('importer', () => {
  it('parses JSONL into knowledge units', () => {
    const jsonl = '{"id":"1","text":"Use JWT","type":"decision"}\n{"id":"2","text":"No ORMs","type":"preference"}\n';
    const units = parseKnowledgeJSONL(jsonl);
    expect(units).toHaveLength(2);
    expect(units[0].text).toBe('Use JWT');
  });

  it('skips malformed lines', () => {
    const jsonl = '{"id":"1","text":"ok"}\nnot json\n{"id":"2","text":"also ok"}\n';
    const units = parseKnowledgeJSONL(jsonl);
    expect(units).toHaveLength(2);
  });

  it('append strategy returns all units', () => {
    const incoming = [{ id: '1', text: 'new' }] as any[];
    const existing = [{ id: '2', text: 'old' }] as any[];
    const result = applyMergeStrategy('append', incoming, existing);
    expect(result).toHaveLength(1);
  });

  it('replace strategy returns only incoming', () => {
    const incoming = [{ id: '1', text: 'new' }] as any[];
    const existing = [{ id: '2', text: 'old' }] as any[];
    const result = applyMergeStrategy('replace', incoming, existing);
    expect(result).toHaveLength(1);
  });

  it('merge strategy deduplicates by text similarity', () => {
    const incoming = [
      { id: '1', text: 'Use JWT for auth', confidence: 0.9 },
      { id: '2', text: 'totally unique knowledge', confidence: 0.8 },
    ] as any[];
    const existing = [
      { id: '3', text: 'Use JWT for auth', confidence: 0.85 },
    ] as any[];
    const result = applyMergeStrategy('merge', incoming, existing);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('totally unique knowledge');
  });
});
