import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Type errors still fail the build. No ESLint config is set up yet.
  eslint: { ignoreDuringBuilds: true },
  // Old waitlist links, including ones already shared, go to sign-up.
  async redirects() {
    return [{ source: '/waitlist', destination: '/signup', permanent: true }];
  },
};

export default nextConfig;
