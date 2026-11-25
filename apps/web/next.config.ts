import type { NextConfig } from 'next';

/**
 * Static export: the whole app is client-rendered and served as plain files from
 * Firebase Hosting (security headers are set in firebase.json).
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const config: NextConfig = {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: !!basePath, // GitHub Pages serves folder/index.html
  reactStrictMode: true,
  transpilePackages: ['@pansari/shared', '@pansari/adapters', '@pansari/client'],
  poweredByHeader: false,
  images: { unoptimized: true },
};

export default config;
