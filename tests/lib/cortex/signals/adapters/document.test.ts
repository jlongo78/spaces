import { describe, it, expect } from 'vitest';
import { classifyDocument, parseDocument } from '@/lib/cortex/signals/adapters/document';

describe('classifyDocument', () => {
  it('classifies ADR files as decisions', () => {
    expect(classifyDocument('docs/adr/001-use-postgres.md')).toBe('decision');
  });

  it('classifies runbook files as pattern', () => {
    expect(classifyDocument('docs/runbook/deploy-production.md')).toBe('pattern');
  });

  it('classifies README as context', () => {
    expect(classifyDocument('README.md')).toBe('context');
  });
});

describe('parseDocument', () => {
  it('creates envelope from document content', () => {
    const result = parseDocument({
      path: 'docs/adr/001-use-postgres.md',
      content: 'We decided to use PostgreSQL.',
    });

    expect(result.origin.source_type).toBe('document');
    expect(result.origin.source_ref).toBe('docs/adr/001-use-postgres.md');
    expect(result.suggested_type).toBe('decision');
    expect(result.text).toBe('We decided to use PostgreSQL.');
  });

  it('truncates very long documents', () => {
    const longContent = 'a'.repeat(10000);
    const result = parseDocument({ path: 'docs/some-guide.md', content: longContent });

    expect(result.text.length).toBeLessThanOrEqual(4000);
  });

  it('sets higher authority via raw_metadata', () => {
    const result = parseDocument({
      path: 'docs/runbook/restart-service.md',
      content: 'Steps to restart the service.',
    });

    expect(result.raw_metadata.authority_boost).toBe(true);
  });
});
