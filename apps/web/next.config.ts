import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,

  // Workspace packages ship TypeScript source rather than a build step. Next
  // compiles them with the app, which keeps the monorepo free of a `dist`
  // rebuild in the middle of every dev loop.
  transpilePackages: ['@editz/ui', '@editz/tool-registry', '@editz/engine-core', '@editz/engine-client'],

  // Cross-origin isolation (COOP/COEP) is required for SharedArrayBuffer and
  // therefore for multi-threaded ffmpeg.wasm — but it breaks every
  // third-party embed on the page. It is applied per-route in middleware.ts,
  // to tool pages only, rather than globally here. See §11.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default config;
