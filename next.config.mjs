import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  reactStrictMode: true,
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {

    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: ['date-fns'],
  },
};

export default nextConfig;
