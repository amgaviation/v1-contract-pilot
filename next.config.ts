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
  experimental: {
    serverActions: {
      // Receipt upload goes through a Server Action, and Next caps a
      // Server Action body at 1 MB by default. A phone photo of a hotel
      // folio is routinely 2-5 MB, so without this the primary Phase 4
      // use case fails with an opaque framework error BEFORE any of the
      // app's own checks or the bucket's file_size_limit can produce a
      // sentence. Kept in step with MAX_RECEIPT_BYTES in
      // app/(app)/expenses/actions.ts and with the bucket's own limit —
      // all three are 10 MB, and the bucket is the authoritative one.
      bodySizeLimit: "10mb",
    },
  },
  // Next.js only auto-inlines env vars prefixed NEXT_PUBLIC_ into the
  // browser bundle. The project's Vercel env vars use NEXT_SUPABASE_URL /
  // NEXT_SUPABASE_PUBLISHABLE_KEY instead (no NEXT_PUBLIC_ prefix), so
  // lib/supabase/client.ts (a browser-side module) would otherwise see
  // both as undefined. This `env` block is Next's supported mechanism for
  // inlining a specific, named var into the client bundle regardless of
  // prefix — deliberately limited to these two, since both are safe to
  // ship to the browser (a Supabase project URL and its publishable key
  // are public by design, same as an anon key). NEVER add
  // NEXT_SUPABASE_SECRET_KEY here — that would bake the service-role
  // secret into the client JavaScript bundle, shipped to every visitor.
  env: {
    NEXT_SUPABASE_URL: process.env.NEXT_SUPABASE_URL,
    NEXT_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_SUPABASE_PUBLISHABLE_KEY,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
