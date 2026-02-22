import type { NextConfig } from "next";

const isElectron = process.env.ELECTRON === '1';
const useStandalone = isElectron || process.env.STANDALONE === '1';

const nextConfig: NextConfig = {
  ...(useStandalone ? { output: 'standalone' } : {}),
  basePath: isElectron ? undefined : (process.env.NEXT_PUBLIC_BASE_PATH || undefined),
  trailingSlash: true,
  serverExternalPackages: ['better-sqlite3', 'node-pty', 'ws'],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
