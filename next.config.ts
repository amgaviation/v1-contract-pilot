import type { NextConfig } from "next";

// The Supabase project origin, derived from the same env var
// lib/supabase/server.ts and lib/supabase/client.ts already read — never
// hand-typed, so a project migration (a new ref) can't leave the CSP
// pointed at the old one. Both http(s) and the matching ws(s) scheme are
// derived: the REST/Auth client uses the former; nothing in this codebase
// opens a Supabase Realtime channel today (checked — no `.channel(` call
// site), but admitting the websocket scheme too costs nothing and avoids a
// silent break the day one is added.
function supabaseOrigins(): { http: string | null; ws: string | null } {
  const raw = process.env.NEXT_SUPABASE_URL;
  if (!raw) return { http: null, ws: null };
  try {
    const origin = new URL(raw).origin;
    return { http: origin, ws: origin.replace(/^http/, "ws") };
  } catch {
    return { http: null, ws: null };
  }
}

// Content-Security-Policy, built once here rather than as a static string,
// so it can fold in the Supabase origin without anyone hand-copying it.
// Mirrors amgaviation/amg1's next.config.ts pattern per the comment this
// replaces. Audited against every rendered-content and script-loading
// surface in this app before enforcing:
//
//   - script-src needs 'wasm-unsafe-eval': tesseract.js compiles the OCR
//     engine's WebAssembly core (public/ocr/core, synced by
//     scripts/sync-ocr-assets.mjs) in the main thread's worker.
//   - script-src and style-src need 'unsafe-inline': the App Router
//     hydrates by pushing the RSC payload through inline <script> tags
//     with no nonce wired up (that needs a per-request nonce threaded
//     through proxy.ts and every layout — a larger change than this pass),
//     and React's inline `style={}` props render as literal `style="..."`
//     attributes throughout components/ui. Both are a real reduction in
//     what a stylesheet/script tag can express, not a placeholder: outside
//     'self', no remote <script src> or <link rel=stylesheet> is
//     admitted at all.
//   - worker-src is 'self' ONLY, deliberately no `blob:`. tesseract.js
//     defaults to re-serving its worker script as a blob: URL; this app
//     turns that off (`workerBlobURL: false` in lib/receipt-ocr/engine.ts,
//     enforced by scripts/sync-ocr-assets.mjs) specifically so `worker-src
//     blob:` never has to enter this policy — see that file's comment: a
//     blob-sourced worker is a standard way to run arbitrary JS around a
//     script-src that forbids it, defeating the point of this header for
//     any future XSS. The OCR worker instead loads from the same-origin
//     `/ocr/worker.min.js` path, which plain 'self' already covers.
//   - img-src needs `data:`: the invoice/packet share pages inline receipt
//     images as data: URIs server-side (app/invoice/[token]/page.tsx) —
//     deliberately, per that file's comment, since there is no remote URL
//     for next/image to optimise.
//   - connect-src needs the Supabase origin: every auth/DB call from the
//     browser client (lib/supabase/client.ts) goes there directly.
//   - form-action is 'self' only: every Stripe hop in this app (Connect
//     OAuth, Checkout, the customer billing portal) is a server-side
//     redirect via Next's redirect() — a Location header, not a client
//     <form action> — so no Stripe origin needs a form-action entry. If
//     that ever changes, this needs https://connect.stripe.com added
//     alongside it.
//   - frame-ancestors 'none': nothing in this app is meant to be framed by
//     anyone, including itself (no iframe/frame use exists in the
//     codebase — checked). Stricter than the legacy X-Frame-Options:
//     SAMEORIGIN header kept below for pre-CSP3 browsers.
//   - vercel.live is admitted on PREVIEW DEPLOYMENTS ONLY, never in
//     production. The Vercel Toolbar and its Comments feature inject
//     https://vercel.live/_next-live/feedback/feedback.js, which this
//     policy blocked outright, so review comments on a preview silently
//     did nothing. The hosts are Vercel's documented set
//     (vercel.com/docs/vercel-toolbar/managing-toolbar, read 2026-08-16);
//     the pusher socket is how the toolbar streams comments live.
//
//     GATED ON VERCEL_ENV, not on NODE_ENV. A preview build is a
//     production build, so NODE_ENV is "production" on both and could not
//     tell them apart. VERCEL_ENV is "preview" only on preview
//     deployments and is absent when building anywhere else, so the
//     default when it is missing is the strict policy rather than the
//     loose one. The production header is byte for byte what it was
//     before this block existed, which is the property that matters: a
//     review convenience must not widen what the deployed product allows.
function contentSecurityPolicy(): string {
  const { http: supabaseHttp, ws: supabaseWs } = supabaseOrigins();

  const isPreview = process.env.VERCEL_ENV === "preview";
  const live = isPreview ? ["https://vercel.live"] : [];

  const connectSrc = ["'self'", supabaseHttp, supabaseWs]
    .concat(isPreview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : [])
    .filter(Boolean)
    .join(" ");
  const imgSrc = ["'self'", "data:", supabaseHttp]
    .concat(isPreview ? ["https://vercel.live", "https://vercel.com"] : [])
    .filter(Boolean)
    .join(" ");

  // Development only: React's dev build reconstructs component stacks with
  // eval(), so `next dev` under this CSP renders a page that never hydrates
  // (the layout CI job runs its browser probes against dev and caught
  // exactly that). React never uses eval() in production builds — its own
  // console message says so — so the production policy stays eval-free.
  const scriptEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

  const scriptSrc = ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]
    .concat(live)
    .join(" ");
  const styleSrc = ["'self'", "'unsafe-inline'"].concat(live).join(" ");
  const fontSrc = ["'self'", "data:"]
    .concat(isPreview ? ["https://vercel.live", "https://assets.vercel.com"] : [])
    .join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}${scriptEval}`,
    `style-src ${styleSrc}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `connect-src ${connectSrc}`,
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // frame-src, not frame-ancestors: the toolbar renders its own UI in an
    // iframe this page embeds. frame-ancestors stays 'none' below, so
    // nothing gains the right to embed THIS app.
    ...(isPreview ? ["frame-src 'self' https://vercel.live"] : []),
    "frame-ancestors 'none'",
  ].join("; ");
}

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
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
];

const nextConfig: NextConfig = {
  // Unlike amg1, typecheck errors fail the build here — no legacy debt to
  // carry, so there's no reason to relax this.
  typescript: {
    ignoreBuildErrors: false,
  },
  // No file in this app imports next/image today (verified by grep). Every
  // plain <img> call site is expected to carry its own LOCAL comment
  // explaining why next/image doesn't apply there (a small already-optimised
  // SVG, or — app/invoice/[token]/page.tsx — a data: URI receipt with no
  // remote URL for next/image to optimise). Deliberately not enumerated or
  // counted here: a hardcoded list or count in this file drifts the moment a
  // call site is added, edited, or gets its justification comment written
  // later than the call site itself, and a stale count reads as verified
  // when it no longer is (caught happening exactly that way on 2026-08-19 —
  // this comment cited "two" call sites against a codebase that by then had
  // eight, three of them uncommented). The standing rule is what has to stay
  // true, not a snapshot of it: run `grep -rn '<img' app/` before relying on
  // this being current, and if you add an <img>, add its justification next
  // to it, not here.
  //
  // This block itself is forward-provisioning, not live optimisation. Before
  // the first next/image use on a remote (Supabase Storage) receipt URL,
  // this also needs `images.remotePatterns` for that host.
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
    return [
      { source: "/:path*", headers: securityHeaders },
      // The OCR engine (public/ocr/*: tesseract's wasm core, worker, and
      // ~2.9 MB English language model) is otherwise served with Vercel's
      // default public/ caching — max-age=0, must-revalidate — which pays
      // a conditional-request round trip on every scan session, on exactly
      // the ramp-grade LTE this product's mobile-first posture targets.
      // These bytes only change when scripts/sync-ocr-assets.mjs re-syncs
      // them off a tesseract.js version bump, so a day of staleness is
      // harmless. Scoped to /ocr/ only — every other path keeps the
      // default caching set above.
      {
        source: "/ocr/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
