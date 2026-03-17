export interface LobeSubscription {
  type: 'workspace' | 'user' | 'tag' | 'team' | 'department' | 'organization';
  id: string;
  label: string;
}

export interface LobeConfig {
  isPrivate: boolean;
  excludedFrom: number[];
  subscriptions: LobeSubscription[];
  tags: string[];
}

export const DEFAULT_LOBE_CONFIG: LobeConfig = {
  isPrivate: false,
  excludedFrom: [],
  subscriptions: [],
  tags: [],
};

export function parseLobeConfig(raw: string | null | undefined): LobeConfig {
  if (!raw) return { ...DEFAULT_LOBE_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return {
      isPrivate: parsed.isPrivate ?? false,
      excludedFrom: Array.isArray(parsed.excludedFrom) ? parsed.excludedFrom : [],
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch {
    return { ...DEFAULT_LOBE_CONFIG };
  }
}

export function serializeLobeConfig(config: LobeConfig): string {
  return JSON.stringify(config);
}
