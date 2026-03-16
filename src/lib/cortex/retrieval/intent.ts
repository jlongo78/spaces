export interface IntentBiases {
  scope_boost: Record<string, number>;  // scope level → multiplier
  type_boost: Record<string, number>;   // knowledge type → multiplier
  recency_boost: number;
}

export interface IntentDefinition {
  patterns: RegExp[];
  keywords: string[];
  biases: IntentBiases;
}

export interface DetectedIntent {
  intent: string;
  confidence: number;
  biases: IntentBiases;
}

export const INTENTS: Record<string, IntentDefinition> = {
  debugging: {
    patterns: [
      /error/i,
      /bug/i,
      /fix/i,
      /crash/i,
      /fail/i,
      /broken/i,
      /throw/i,
      /exception/i,
      /timeout/i,
      /issue/i,
      /why does/i,
      /why is/i,
      /why did/i,
    ],
    keywords: [
      'error', 'bug', 'fix', 'crash', 'fail', 'broken',
      'throw', 'exception', 'timeout', 'issue',
    ],
    biases: {
      scope_boost: { personal: 1.2, team: 0.8, department: 0.6, organization: 0.5 },
      type_boost: { error_fix: 1.5, code_pattern: 1.2, context: 1.1 },
      recency_boost: 1.3,
    },
  },

  architecture: {
    patterns: [
      /architect/i,
      /design/i,
      /pattern/i,
      /structure/i,
      /approach/i,
      /should we use/i,
      /should we adopt/i,
      /should we switch/i,
    ],
    keywords: [
      'architect', 'architecture', 'design', 'pattern', 'structure', 'approach',
    ],
    biases: {
      scope_boost: { personal: 0.8, team: 1.1, department: 1.2, organization: 1.3 },
      type_boost: { decision: 1.5, pattern: 1.3, code_pattern: 1.1 },
      recency_boost: 1.0,
    },
  },

  onboarding: {
    patterns: [
      /how does/i,
      /explain/i,
      /what is/i,
      /overview/i,
      /getting started/i,
    ],
    keywords: [
      'explain', 'overview', 'introduction', 'overview', 'onboard',
    ],
    biases: {
      scope_boost: { personal: 0.7, team: 1.0, department: 1.1, organization: 1.2 },
      type_boost: { summary: 1.4, context: 1.2, decision: 1.1 },
      recency_boost: 0.9,
    },
  },

  policy: {
    patterns: [
      /policy/i,
      /compliance/i,
      /regulation/i,
      /standard/i,
      /rule/i,
      /requirement/i,
    ],
    keywords: [
      'policy', 'compliance', 'regulation', 'standard', 'rule', 'requirement',
    ],
    biases: {
      scope_boost: { personal: 0.5, team: 0.9, department: 1.2, organization: 1.5 },
      type_boost: { decision: 1.4, pattern: 1.1, context: 1.0 },
      recency_boost: 1.1,
    },
  },

  'how-to': {
    patterns: [
      /how do I/i,
      /how can I/i,
      /how to/i,
      /how should I/i,
      /steps to/i,
      /steps for/i,
      /what's the command/i,
      /what's the way/i,
      /what's the process/i,
    ],
    keywords: [
      'steps', 'guide', 'tutorial', 'walkthrough', 'instructions',
    ],
    biases: {
      scope_boost: { personal: 1.1, team: 1.0, department: 0.9, organization: 0.8 },
      type_boost: { command: 1.5, code_pattern: 1.2, context: 1.0 },
      recency_boost: 1.2,
    },
  },

  review: {
    patterns: [
      /review/i,
      /feedback/i,
      /improve/i,
      /quality/i,
      /best practice/i,
    ],
    keywords: [
      'review', 'feedback', 'improve', 'quality', 'refactor', 'optimize',
    ],
    biases: {
      scope_boost: { personal: 1.0, team: 1.2, department: 1.1, organization: 1.0 },
      type_boost: { pattern: 1.4, code_pattern: 1.3, decision: 1.1 },
      recency_boost: 1.0,
    },
  },

  security: {
    patterns: [
      /security/i,
      /vulnerab/i,
      /exploit/i,
      /attack/i,
      /auth/i,
      /cve/i,
      /injection/i,
      /xss/i,
    ],
    keywords: [
      'security', 'vulnerability', 'exploit', 'attack', 'auth',
      'cve', 'injection', 'xss', 'threat',
    ],
    biases: {
      scope_boost: { personal: 0.8, team: 1.1, department: 1.2, organization: 1.3 },
      type_boost: { decision: 1.4, error_fix: 1.3, pattern: 1.2 },
      recency_boost: 1.4,
    },
  },

  general: {
    patterns: [],
    keywords: [],
    biases: {
      scope_boost: { personal: 1.0, team: 1.0, department: 1.0, organization: 1.0 },
      type_boost: {},
      recency_boost: 1.0,
    },
  },
};

/**
 * Scores each intent via regex pattern matches (weight 2) + keyword substring
 * matches (weight 1). Returns the best-scoring intent with confidence and biases.
 * Falls back to 'general' if no patterns match.
 */
export function detectIntent(query: string): DetectedIntent {
  const scores: Record<string, number> = {};

  for (const [name, def] of Object.entries(INTENTS)) {
    if (name === 'general') continue;

    let score = 0;

    for (const pattern of def.patterns) {
      if (pattern.test(query)) {
        score += 2;
      }
    }

    const lowerQuery = query.toLowerCase();
    for (const keyword of def.keywords) {
      if (lowerQuery.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }

    scores[name] = score;
  }

  const maxScore = Math.max(...Object.values(scores));

  if (maxScore === 0) {
    return {
      intent: 'general',
      confidence: 0,
      biases: INTENTS['general'].biases,
    };
  }

  const bestIntent = Object.entries(scores).reduce(
    (best, [name, score]) => (score > best[1] ? [name, score] : best),
    ['general', 0] as [string, number],
  )[0];

  // Normalise confidence: max possible score per query is bounded by
  // patterns.length * 2 + keywords.length, so use a softer cap via tanh-style.
  // Here we use a simple ratio relative to the winning intent's max possible score.
  const def = INTENTS[bestIntent];
  const maxPossible = def.patterns.length * 2 + def.keywords.length;
  const confidence = maxPossible > 0 ? Math.min(1.0, maxScore / maxPossible) : 0;

  return {
    intent: bestIntent,
    confidence,
    biases: def.biases,
  };
}
