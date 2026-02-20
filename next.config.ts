import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'node-pty', 'ws'],
  turbopack: {},
};

export default nextConfig;
