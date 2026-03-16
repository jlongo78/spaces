import { describe, it, expect } from 'vitest';
import { classifySensitivity } from '@/lib/cortex/boundary/classifier';

describe('classifySensitivity', () => {
  it('classifies secrets as confidential', () => {
    expect(classifySensitivity('API_KEY=abc123')).toBe('confidential');
    expect(classifySensitivity('password: hunter2')).toBe('confidential');
    expect(classifySensitivity('DATABASE_URL=postgres://user:pass@host/db')).toBe('confidential');
  });

  it('classifies personnel content as confidential', () => {
    expect(classifySensitivity('performance review for Q2')).toBe('confidential');
    expect(classifySensitivity('her salary is $120k')).toBe('confidential');
  });

  it('classifies security content as restricted', () => {
    expect(classifySensitivity('SQL injection vulnerability found')).toBe('restricted');
    expect(classifySensitivity('affects CVE-2024-1234 patch')).toBe('restricted');
  });

  it('classifies business content as restricted', () => {
    expect(classifySensitivity('Q3 revenue targets')).toBe('restricted');
    expect(classifySensitivity('unreleased product roadmap')).toBe('restricted');
  });

  it('classifies technical content as internal', () => {
    expect(classifySensitivity('decided to use PostgreSQL as the service')).toBe('internal');
    expect(classifySensitivity('updated the middleware layer')).toBe('internal');
  });

  it('classifies general content as public', () => {
    expect(classifySensitivity('git rebase to clean up history')).toBe('public');
    expect(classifySensitivity('JavaScript arrays are zero-indexed')).toBe('public');
  });

  it('returns most restrictive level when multiple patterns match', () => {
    // Contains both a confidential pattern (API_KEY) and a restricted pattern (CVE)
    expect(classifySensitivity('API_KEY=abc and CVE-2024-9999 mentioned')).toBe('confidential');
  });
});
