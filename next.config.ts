import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.STANDALONE === '1' ? 'standalone' : undefined,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  trailingSlash: true,
  serverExternalPackages: ['better-sqlite3', 'node-pty', 'ws', '@spaces/pro'],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
