import type { NextConfig } from "next";

const basePath = process.env.SPACES_BASE_PATH || '';

const nextConfig: NextConfig = {
  reactStrictMode: false,
  output: process.env.STANDALONE === '1' ? 'standalone' : undefined,
  basePath: basePath || undefined,
  trailingSlash: true,
  // Inline SPACES_BASE_PATH into the client bundle so api() can use it
  env: { SPACES_BASE_PATH: basePath },
  serverExternalPackages: ['better-sqlite3', 'node-pty', 'ws', 'chokidar', '@spaces/pro', '@spaces/teams'],
  allowedDevOrigins: ['arc.robindale.com'],
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
