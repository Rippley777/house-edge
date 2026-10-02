import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  devIndicators: false,
  poweredByHeader: false,
  allowedDevOrigins: ['127.0.0.1'],
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  serverExternalPackages: ['better-sqlite3', 'mssql', 'maxmind'],
  turbopack: { root: path.resolve(process.cwd(), '../..') },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ] }];
  },
};
export default config;
