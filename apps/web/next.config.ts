import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    // Baseline security headers on every page. Later entries override earlier ones for the same key.
    const site = { source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ] };
    return [site, ...['/auth/:path*', '/open-app'].map((source) => ({ source, headers: [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Cache-Control', value: 'no-store' },
    ] }))];
  },
  // Type errors still fail the build. No ESLint config is set up yet.
  eslint: { ignoreDuringBuilds: true },
  // Old waitlist links, including ones already shared, go to sign-up.
  async redirects() {
    return [{ source: '/waitlist', destination: '/signup', permanent: true }];
  },
};

export default nextConfig;
