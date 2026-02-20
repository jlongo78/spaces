import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  trailingSlash: true,
  serverExternalPackages: ['better-sqlite3', 'node-pty', 'ws'],
  turbopack: {},
};

export default nextConfig;
