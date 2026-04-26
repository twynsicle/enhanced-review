import type { NextConfig } from 'next';

// PocketBase serves user avatars (auto-downloaded from the GitHub OAuth
// provider on sign-in) from its own host. Allow that host through
// next/image's remote loader.
const pbRemote = (() => {
  const raw = process.env.NEXT_PUBLIC_POCKETBASE_URL ?? process.env.POCKETBASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      protocol: u.protocol.replace(':', '') as 'http' | 'https',
      hostname: u.hostname,
      port: u.port || undefined,
    };
  } catch {
    return null;
  }
})();

// Next 16 blocks image optimization for upstreams resolving to private IPs by
// default. Local dev points PB at 127.0.0.1, so opt in when the configured PB
// host is obviously local — otherwise leave the default protection in place.
const isLocalHost = (h: string) =>
  h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1';

const nextConfig: NextConfig = {
  // Transpile workspace packages so their raw TS sources work without a
  // build step. Phase 4's worker also consumes these packages.
  transpilePackages: ['@enhanced-review/github-client', '@enhanced-review/review-types'],
  images: {
    remotePatterns: [
      // GitHub avatars (used on the placeholder home + later anywhere we
      // surface a reviewer identity).
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
      ...(pbRemote ? [pbRemote] : []),
    ],
    dangerouslyAllowLocalIP: pbRemote ? isLocalHost(pbRemote.hostname) : false,
  },
};

export default nextConfig;
