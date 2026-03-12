// Deterministic pseudo-random from seed
export function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

export function matchesSearch(name: string, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return name.toLowerCase().includes(q);
}
