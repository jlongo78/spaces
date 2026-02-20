import type { NextConfig } from "next";

const isElectron = process.env.ELECTRON === '1';

const nextConfig: NextConfig = {
  basePath: isElectron ? undefined : (process.env.NEXT_PUBLIC_BASE_PATH || undefined),
  trailingSlash: true,
  serverExternalPackages: ['better-sqlite3', 'node-pty', 'ws'],
  turbopack: {},
  ...(isElectron ? { output: 'standalone' } : {}),
};

export default nextConfig;
