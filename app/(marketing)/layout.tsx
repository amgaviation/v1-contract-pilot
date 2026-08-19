import type { Metadata, Viewport } from "next";
import "@/app/design/marketing.css";
import { BRAND, MARKETING_THEME_COLOR } from "@/lib/brand";
import SiteNav from "./site-nav";
import SiteFooter from "./site-footer";

/**
 * The signed-out marketing surface: "/", "/pricing", "/terms", "/privacy"
 * (app/(marketing)/{page,pricing,terms,privacy}.tsx). A route group, same
 * mechanism app/(app) and app/(auth) already use — it does not change any
 * URL, it just gives these four pages one shared header/footer instead of
 * each re-declaring it.
 *
 * `robots` here overrides the product-wide `index: false, follow: false`
 * set in app/layout.tsx. Next's metadata resolution replaces a field
 * wholesale at the nearest segment that redeclares it, so this object is
 * the WHOLE robots directive for every page below it, not a merge with the
 * root's — these four pages are the only public-facing surface this
 * product has any reason to let a crawler see; the authenticated product
 * stays noindex exactly as app/layout.tsx's own comment explains.
 *
 * INDEXABLE ONLY ON THE PRODUCTION DEPLOYMENT, and that condition is the
 * whole point. docs/LAUNCH-GATES.md G2 and G7 both draw their line at
 * "existing in the repo and rendering on a preview host is not publishing"
 * — that carve-out is only honest if a preview genuinely cannot be found
 * by a stranger. A flat `index: true` made it false: every preview
 * deployment of every branch would have invited crawlers to an unsigned
 * price and to counsel-gated feature copy, which is exactly what those
 * gates exist to prevent.
 *
 * VERCEL_ENV is "production", "preview" or "development", and is absent on
 * a local machine — so anything that is not the production deployment
 * reads as not-production and stays noindex. Erring that way costs
 * nothing: the worst case is that the real site needs one deploy to
 * become indexable, whereas the opposite default leaks a price the owner
 * has not signed.
 */
const isProductionDeployment = process.env.VERCEL_ENV === "production";

/**
 * openGraph/twitter carry NO title or description of their own, and that
 * is deliberate: Next fills both from each page's RESOLVED metadata when
 * the blocks omit them (resolve-metadata.js `inheritFromMetadata`, and
 * twitter additionally falls back to openGraph). So the landing page's
 * link preview uses the root description — the one crawlable sentence
 * app/layout.tsx maintains — and /pricing's uses its own page-level
 * description, with zero duplicated strings here to drift out of step.
 * `url: "./"` resolves against metadataBase + the current pathname, so
 * each page's og:url is its own canonical URL, not a shared one.
 */
// public/brand/og-image.png — the mark plus BRAND.tagline on the brand
// kit's navy ground, rasterized once from the same source as
// public/brand/expanded.svg. No fake screenshot, no AMG attribution
// (that stays confined to the footer/about page per lib/brand.ts) — a
// link preview in a group text or a pilot forum gets the mark and the
// one sentence, nothing else.
const OG_IMAGE = {
  url: "/brand/og-image.png",
  width: 1200,
  height: 630,
  alt: `${BRAND.name}: ${BRAND.tagline}`,
} as const;

export const metadata: Metadata = {
  robots: { index: isProductionDeployment, follow: true },
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    url: "./",
    locale: "en_US",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    images: [OG_IMAGE.url],
  },
};

/**
 * Dark chrome tint for the dark surface — overrides the root layout's
 * paper-white THEME_COLOR for this route group only, so a phone's address
 * bar matches the page under it. Next merges viewport per segment the
 * same way it merges metadata.
 */
export const viewport: Viewport = {
  themeColor: MARKETING_THEME_COLOR,
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // THE `.mkt` SCOPE — the whole marketing reskin hangs off this one
    // class. app/design/marketing.css remaps the --ledger-* custom
    // properties inside it (brand navy at its floor, alpha hairlines,
    // the brand accent promoted to working accent), so every token
    // utility below — bg-canvas, text-ink, border-hair, shadow-float —
    // resolves dark with no per-callsite variants and nothing new to
    // keep in step with the product's sheet. The authenticated product
    // never renders inside this class and keeps Ledger's paper.
    // dvh, not vh: the app shell's own comment documents why (mobile
    // URL-bar overhang creates phantom scroll on a fixed 100vh).
    <div className="mkt flex min-h-dvh flex-col bg-canvas font-ledger text-body text-ink">
      <SiteNav />
      <main className="flex flex-1 flex-col">{children}</main>
      <SiteFooter />
    </div>
  );
}
