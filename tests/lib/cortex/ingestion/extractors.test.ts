import { describe, it, expect } from 'vitest';
import {
  detectErrorFixPairs,
  extractCommands,
  extractDecisionPatterns,
} from '@/lib/cortex/ingestion/extractors';

describe('extractors', () => {
  describe('detectErrorFixPairs', () => {
    it('detects error followed by resolution', () => {
      const text = `
[assistant]: Running the build...
Error: Cannot find module 'foo'
[human]: try installing it
[assistant]: Fixed! Installed foo with npm install foo.
      `;
      const pairs = detectErrorFixPairs(text);
      expect(pairs).toHaveLength(1);
      expect(pairs[0].error).toContain('Cannot find module');
      expect(pairs[0].fix).toContain('npm install foo');
    });
  });

  describe('extractCommands', () => {
    it('extracts shell commands from code blocks', () => {
      const text = '```bash\nnpm install foo\nnpm run build\n```';
      const commands = extractCommands(text);
      expect(commands).toContain('npm install foo');
      expect(commands).toContain('npm run build');
    });
  });

  describe('extractDecisionPatterns', () => {
    it('detects decision language', () => {
      const text = "We decided to use Zod for validation because it integrates well with TypeScript.";
      const decisions = extractDecisionPatterns(text);
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toContain('Zod');
    });
  });
});
