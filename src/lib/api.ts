const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export const api = (path: string) => {
  // Ensure trailing slash on the pathname to avoid 308 redirects (trailingSlash: true in next.config)
  // But don't corrupt query strings by appending "/" after them
  const qIndex = path.indexOf('?');
  if (qIndex === -1) {
    // No query string — just ensure trailing slash
    const normalized = path.endsWith('/') ? path : `${path}/`;
    return `${BASE}${normalized}`;
  }
  // Has query string — add trailing slash to the path portion only
  const pathname = path.slice(0, qIndex);
  const query = path.slice(qIndex);
  const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${BASE}${normalizedPath}${query}`;
};
