import { describe, it, expect } from 'vitest';
import { createManifest, serializeKnowledgeToJSONL } from '@/lib/cortex/portability/exporter';

describe('exporter', () => {
  it('creates a valid manifest', () => {
    const manifest = createManifest({
      scope: 'full',
      unitCount: 42,
      includeEmbeddings: false,
    });
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.unitCount).toBe(42);
    expect(manifest.includeEmbeddings).toBe(false);
    expect(manifest.exportDate).toBeDefined();
  });

  it('serializes knowledge units to JSONL', () => {
    const units = [
      { id: '1', text: 'Use JWT', type: 'decision', confidence: 0.9, vector: [0.1, 0.2] },
      { id: '2', text: 'No ORMs', type: 'preference', confidence: 0.95, vector: [0.3, 0.4] },
    ];
    const jsonl = serializeKnowledgeToJSONL(units as any);
    const lines = jsonl.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('1');
    expect(JSON.parse(lines[1]).id).toBe('2');
    // Vectors should be stripped
    expect(JSON.parse(lines[0]).vector).toBeUndefined();
  });
});
