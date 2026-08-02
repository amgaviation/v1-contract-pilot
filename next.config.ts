import type { NextConfig } from "next";

// Baseline security headers. No Content-Security-Policy yet: CSP needs the
// real Supabase project URL and Stripe/Stripe Connect origins, neither of
// which exist until Phase 0 infra (Supabase project) and Phase 2 (Stripe)
// are wired up. Add a CSP mirroring amgaviation/amg1's next.config.ts
// pattern as soon as those origins are known — do not ship to production
// without one.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  // Unlike amg1, typecheck errors fail the build here — no legacy debt to
  // carry, so there's no reason to relax this.
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
