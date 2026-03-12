export interface FileStaleInput {
  fileRefs: string[];
  sourceTimestamp: string;
  fileModTimes: Record<string, string>;
}

export function computeFileStaleScore(input: FileStaleInput): number {
  if (input.fileRefs.length === 0) return 0;

  const sourceTime = new Date(input.sourceTimestamp).getTime();
  let maxStaleness = 0;

  for (const ref of input.fileRefs) {
    const modTime = input.fileModTimes[ref];
    if (!modTime) continue;
    const modMs = new Date(modTime).getTime();
    if (modMs > sourceTime) {
      const daysSince = (modMs - sourceTime) / (1000 * 60 * 60 * 24);
      const staleness = 1 - Math.exp(-daysSince / 30);
      maxStaleness = Math.max(maxStaleness, staleness);
    }
  }

  return Math.min(maxStaleness, 1);
}

export function computeTimeDecay(createdTimestamp: string, halflifeDays: number): number {
  const ageMs = Date.now() - new Date(createdTimestamp).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return 1 - Math.pow(2, -ageDays / halflifeDays);
}
