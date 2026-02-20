const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const api = (path: string) => `${BASE}${path}`;
