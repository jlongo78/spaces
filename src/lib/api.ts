/**
 * Prefix API paths with basePath and normalize trailing slashes to avoid
 * 308 redirects (trailingSlash: true in next.config).
 *
 * SPACES_BASE_PATH is inlined into the client bundle via next.config.ts `env`.
 */
const BASE = process.env.SPACES_BASE_PATH || '';

export const api = (path: string) => {
  const qIndex = path.indexOf('?');
  if (qIndex === -1) {
    const normalized = path.endsWith('/') ? path : `${path}/`;
    return `${BASE}${normalized}`;
  }
  const pathname = path.slice(0, qIndex);
  const query = path.slice(qIndex);
  const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${BASE}${normalizedPath}${query}`;
};
