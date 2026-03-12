import type { KnowledgeType } from '../knowledge/types';

export interface DistillationPrompt {
  systemPrompt: string;
  userTemplate: (chunks: string[]) => string;
  outputType: KnowledgeType;
}

const EXTRACTION_SYSTEM = `You are a knowledge extraction system. Analyze conversation chunks and extract structured knowledge units. Return JSON arrays only.`;

export const PROMPTS: Record<string, DistillationPrompt> = {
  decisions: {
    systemPrompt: EXTRACTION_SYSTEM,
    userTemplate: (chunks) => `Analyze these conversation chunks and extract any explicit DECISIONS made. A decision is a deliberate choice about architecture, technology, approach, or design.

Return a JSON array of objects with: { "text": "what was decided", "rationale": "why", "confidence": 0.0-1.0 }

Return [] if no decisions found.

Chunks:
${chunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c}`).join('\n\n')}`,
    outputType: 'decision',
  },
  patterns: {
    systemPrompt: EXTRACTION_SYSTEM,
    userTemplate: (chunks) => `Analyze these conversation chunks and extract recurring PATTERNS — approaches, conventions, or techniques used repeatedly.

Return a JSON array of objects with: { "text": "the pattern", "occurrences": number, "confidence": 0.0-1.0 }

Return [] if no patterns found.

Chunks:
${chunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c}`).join('\n\n')}`,
    outputType: 'pattern',
  },
  preferences: {
    systemPrompt: EXTRACTION_SYSTEM,
    userTemplate: (chunks) => `Analyze these conversation chunks and extract user PREFERENCES — corrections, style choices, or explicit "do this, not that" instructions.

Return a JSON array of objects with: { "text": "the preference", "confidence": 0.0-1.0 }

Return [] if no preferences found.

Chunks:
${chunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c}`).join('\n\n')}`,
    outputType: 'preference',
  },
  error_fixes: {
    systemPrompt: EXTRACTION_SYSTEM,
    userTemplate: (chunks) => `Analyze these conversation chunks and extract ERROR/FIX pairs — errors encountered and their solutions.

Return a JSON array of objects with: { "error": "what went wrong", "fix": "how it was resolved", "text": "error: X, fix: Y", "confidence": 0.0-1.0 }

Return [] if no error/fix pairs found.

Chunks:
${chunks.map((c, i) => `--- Chunk ${i + 1} ---\n${c}`).join('\n\n')}`,
    outputType: 'error_fix',
  },
};
