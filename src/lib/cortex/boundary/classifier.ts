import type { SensitivityClass } from '../knowledge/types';

// ─── Detector definitions ordered by descending priority ──────

interface Detector {
  level: SensitivityClass;
  priority: number;
  patterns: RegExp[];
}

const DETECTORS: Detector[] = [
  {
    level: 'confidential',
    priority: 4,
    patterns: [
      /api[_-]?key\s*[=:]/i,
      /sk-ant-/i,
      /password\s*:/i,
      /postgres:\/\/[^:]+:[^@]+@/i,
      /performance\s+review/i,
      /\bsalary\b/i,
      /\bhiring\b/i,
      /1:1\s+notes?/i,
      /private\s+key/i,
    ],
  },
  {
    level: 'restricted',
    priority: 3,
    patterns: [
      /\bvulnerabilit(?:y|ies)\b/i,
      /\bexploit\b/i,
      /\binjection\b/i,
      /CVE-\d{4}-\d+/i,
      /incident\s+report/i,
      /\brevenue\b/i,
      /\bprofit\b/i,
      /\bMRR\b/,
      /\bunreleased\b/i,
      /customer\s+(?:data|PII)/i,
      /\bPII\b/,
    ],
  },
  {
    level: 'internal',
    priority: 2,
    patterns: [
      /\barchitecture\b/i,
      /\bmiddleware\b/i,
      /\bservice\b/i,
      /\bdeployment\b/i,
      /CI\/CD/i,
      /bug\s+fix/i,
      /pull\s+request/i,
      /\brefactor\b/i,
    ],
  },
];

/**
 * Classifies the sensitivity of a given text string.
 * Returns the most restrictive (highest-priority) matching level,
 * defaulting to 'public' when no patterns match.
 */
export function classifySensitivity(text: string): SensitivityClass {
  let best: Detector | null = null;

  for (const detector of DETECTORS) {
    const matches = detector.patterns.some((re) => re.test(text));
    if (matches) {
      if (best === null || detector.priority > best.priority) {
        best = detector;
      }
    }
  }

  return best ? best.level : 'public';
}
