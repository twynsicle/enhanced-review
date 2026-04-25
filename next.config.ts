import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Transpile workspace packages so their raw TS sources work without a
  // build step. Phase 4's worker also consumes these packages.
  transpilePackages: ['@enhanced-review/github-client', '@enhanced-review/review-types'],
  images: {
    remotePatterns: [
      // GitHub avatars (used on the placeholder home + later anywhere we
      // surface a reviewer identity).
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
};

export default nextConfig;
