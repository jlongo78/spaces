// ─── Contradiction Keyword Patterns ───────────────────────────

export const CONTRADICTION_KEYWORDS = {
  negation: [
    /\bnot\b/i,
    /\bdon'?t\b/i,
    /\bdo not\b/i,
    /\bnever\b/i,
    /\bavoid\b/i,
    /\bstop\b/i,
  ],
  replacement: [
    /\binstead of\b/i,
    /\brather than\b/i,
    /\breplace\b.{0,20}\bwith\b/i,
    /\bswitch from\b/i,
    /\bswitch to\b/i,
  ],
  opposition: [
    /\bhowever\b/i,
    /\bbut\b/i,
    /\bcontra\b/i,
    /\boppos/i,
  ],
} as const;

// ─── Cosine Thresholds ─────────────────────────────────────────

export const CONTRADICTION_COSINE_THRESHOLD = 0.80;
export const DEDUP_COSINE_THRESHOLD = 0.90;

// ─── Stop Words ────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'shall', 'can', 'it', 'its', 'this', 'that', 'these', 'those',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
  'up', 'about', 'into', 'through', 'during', 'we', 'you', 'they',
  'he', 'she', 'i', 'my', 'our', 'your', 'their', 'his', 'her',
  'as', 'so', 'if', 'then', 'when', 'where', 'who', 'which',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'nor', 'only', 'same', 'than', 'too',
  'very', 's', 't', 'just', 'now', 'also', 'use', 'used',
]);

// ─── Key Term Extraction ───────────────────────────────────────

function extractKeyTerms(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

// ─── Contradiction Pattern Check ──────────────────────────────

function hasContradictionLanguage(text: string): boolean {
  for (const patterns of Object.values(CONTRADICTION_KEYWORDS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return true;
    }
  }
  return false;
}

// ─── detectSentimentConflict ───────────────────────────────────

/**
 * Returns true if textB appears to contradict textA.
 *
 * Detection logic:
 * 1. Extract key terms from both texts (strip stop words, keep words >2 chars).
 * 2. Check if textB contains any contradiction keyword patterns.
 * 3. If textB has contradiction language AND shares ≥2 key terms with textA → conflict.
 */
export function detectSentimentConflict(textA: string, textB: string): boolean {
  if (!hasContradictionLanguage(textB)) return false;

  const termsA = extractKeyTerms(textA);
  const termsB = extractKeyTerms(textB);

  for (const term of termsB) {
    if (termsA.has(term)) return true;
  }

  return false;
}
