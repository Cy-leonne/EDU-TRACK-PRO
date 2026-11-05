/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The build output directory can be redirected (the end-to-end suite builds
  // into its own directory so it never collides with a running dev server).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  transpilePackages: ['@edutrack/shared-types', '@edutrack/validation', '@edutrack/shared-config'],
  eslint: { ignoreDuringBuilds: true },
  // Requests under /api/v1 are proxied to the Nest API by the route handler in
  // src/app/api/v1/[...path]/route.ts. It reads API_INTERNAL_URL at request time
  // (a rewrite would freeze the API host into the built image), keeps the API
  // port private and avoids CORS/preflight noise entirely.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // NOTE: no X-Frame-Options here on purpose — the app is embedded in the
          // preview frame during development. Restrict framing in production via
          // a CSP frame-ancestors rule at the reverse proxy.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default nextConfig;
