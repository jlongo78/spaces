const ERROR_PATTERNS = [
  /(?:Error|ERROR|error):\s*(.+)/,
  /(?:TypeError|ReferenceError|SyntaxError):\s*(.+)/,
  /(?:ENOENT|EACCES|ECONNRESET|ECONNREFUSED|EPERM|EBUSY)(?::\s*(.+))?/,
  /(?:failed|Failed|FAILED)(?:\s+(?:to|with))?\s+(.+)/,
];

const FIX_PATTERNS = [
  /(?:fixed|Fixed|resolved|Resolved|solved|Solved)[!.]?\s*(.*)/i,
  /(?:the fix|the solution|to fix this|fixed by|resolved by)\s*(.*)/i,
];

const DECISION_PATTERNS = [
  /(?:we (?:decided|chose|went with|settled on|agreed))\s+(?:to\s+)?(.+)/i,
  /(?:let's use|using|switching to|going with)\s+(\S+)\s+(?:for|because|since)\s+(.+)/i,
  /(?:the approach|our approach|the plan) (?:is|will be)\s+(.+)/i,
];

export interface ErrorFixPair {
  error: string;
  fix: string;
}

export function detectErrorFixPairs(text: string): ErrorFixPair[] {
  const pairs: ErrorFixPair[] = [];
  const lines = text.split('\n');
  let lastError: string | null = null;
  let lastErrorIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of ERROR_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        lastError = line.trim();
        lastErrorIdx = i;
        break;
      }
    }
    if (lastError && i - lastErrorIdx < 20) {
      for (const pattern of FIX_PATTERNS) {
        const match = line.match(pattern);
        if (match) {
          pairs.push({ error: lastError, fix: line.trim() });
          lastError = null;
          break;
        }
      }
    }
  }
  return pairs;
}

export function extractCommands(text: string): string[] {
  const commands: string[] = [];
  const bashBlockRegex = /```(?:bash|sh|shell|zsh|cmd)?\n([\s\S]*?)```/g;
  let match;
  while ((match = bashBlockRegex.exec(text)) !== null) {
    const block = match[1].trim();
    for (const line of block.split('\n')) {
      const trimmed = line.replace(/^\$\s*/, '').trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        commands.push(trimmed);
      }
    }
  }
  return commands;
}

export function extractDecisionPatterns(text: string): string[] {
  const decisions: string[] = [];
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    for (const pattern of DECISION_PATTERNS) {
      if (pattern.test(sentence)) {
        decisions.push(sentence);
        break;
      }
    }
  }
  return decisions;
}
